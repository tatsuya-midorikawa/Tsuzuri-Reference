# Timer と Ticker

`Timer` と `Ticker` は、`tzroutine` スケジューラの単調増加クロック（`Time.monotonic_ns` と同一時間軸）に基づき、指定時間の経過を [`Channel<i64>`](./channel.md) への時刻送信として通知する時間同期プリミティブです。

一定時間後に **1 回だけ**発火する遅延・タイムアウト制御には単発タイマー `Timer` を用い、一定間隔ごとに**繰り返し**発火する定期実行には周期ティッカー `Ticker` を用います。どちらもオプトイン標準モジュールであり、生成・リセット時に時計を参照するため `time` 権限を使用します。

## 要点

- `Timer.create d` は `d` ナノ秒後に 1 回だけ現在時刻（ナノ秒）を容量 1 の内部チャネルへ送信する（`d <= 0` の場合は即座に発火可能となる）。
- `Ticker.create period` は `period` ナノ秒ごとに現在時刻を容量 1 の内部チャネルへ送信する（初回発火は `period` ナノ秒後。**`period <= 0` はトラップ**）。
- **滞留データが残らないクリーンな `stop` / `reset` 規則**: `Timer.stop`・`Timer.reset`・`Ticker.stop`・`Ticker.reset` のいずれも、呼び出し完了時点で内部チャネルに古い未読時刻が残らないことを保証する。呼び出し側で手動の空読み（ドレイン）を行う必要はない。
- **リソース管理**: `Timer.channel` および `Ticker.channel` は呼び出すたびに内部チャネルのハンドル参照数を 1 増やすため、**ループの前に 1 回だけ取得**して使い回す。また `Timer` / `Ticker` 本体ハンドルが `Drop` されると、自動的に停止してランタイム資源が解放される。

## `Timer` と `Ticker`（および `Time.after` / `Time.tick`）の使い分け

| 手段 | 発火回数 | 途中停止・周期変更 | 適した場面 |
| --- | --- | --- | --- |
| `Timer` | 単発（`reset` で再利用可） | `Timer.stop` / `Timer.reset` / `Drop` で即座に解放 | ループ内タイムアウト、キャンセル可能な待機、デバウンス処理 |
| `Ticker` | 周期的 | `Ticker.stop` / `Ticker.reset` / `Drop` で即座に解放 | 終了条件を持つ定期ポーリング、レート制限、ハートビート送信 |
| [`Time.after`](../sys/time.md) | 単発 | チャネルのみを返す（明示的 `stop` なし） | 1 回限りの短いタイムアウト待機 |
| [`Time.tick`](../sys/time.md) | 周期的 | 全チャネルハンドルが `Drop` されるまで継続 | スコープ全体で動き続ける単純な周期処理 |

高頻度な `select` ループ内で毎回 `Time.after` を生成すると発火までタイマー資源が残りますが、`Timer` を 1 つ作って毎回 `Timer.reset` すればアロケーションなしで再利用できます。

## `Timer`：単発タイマーと `stop` / `reset` 制御

`Timer.stop` と `Timer.reset` は、呼び出し時点でタイマーが「まだ未発火の待機中だったか」を `bool` で返します（未発火を止めた／張り直した場合は `true`、すでに発火済みまたは停止済みだった場合は `false`）。すでに発火してチャネル内に時刻が入っていた場合でも、`stop` や `reset` を行うとその古い時刻は自動的に取り除かれます。

```tsuzuri run=stop1%3Dtrue%20stop2%3Dfalse%20reset_was_active%3Dfalse%20fired%3Dtrue%20stop_after%3Dfalse
let timer = Timer.create Time.hour()
let ch = Timer.channel (ref timer)

let stop1 = Timer.stop (ref timer)
let stop2 = Timer.stop (ref timer)
let reset_was_active = Timer.reset (ref timer) Time.millisecond()
let fired =
    match Channel.recv ch with
    | Maybe.Some ts -> ts > 0
    | Maybe.None -> false
let stop_after = Timer.stop (ref timer)

$"stop1={stop1} stop2={stop2} reset_was_active={reset_was_active} fired={fired} stop_after={stop_after}"
```

### `Time.after_func` が返す `Timer` との連携

[`Time.after_func`](../sys/time.md) は指定時間後に `Owned.Function<unit, unit>` を別 `tzroutine` で起動する `Timer` ハンドルを返します。この `Timer` に対して `Timer.channel` を呼ぶと閉鎖済みの空チャネルが返ります。発火前に `Timer.stop` でキャンセルした場合は `Timer.reset` で再スケジュールできますが、一度関数が起動された後は `Owned.Function` が消費済みとなるため、`reset` は `false` を返して再実行は行われません。

## `Ticker`：周期ティッカーと遅延吸収

`Ticker.create period` は正の周期 `period`（ナノ秒）を受け取り、等間隔で時刻を送信します。内部チャネルの容量は `1` であり、受信側の処理が長引いて前回の時刻をまだ受け取っていない場合はその回の送信はスキップ（ドロップ）され、受信側が追いついた後に滞留分がまとめて押し寄せることはありません。

```tsuzuri run=monotonic%3Dtrue%20after_stop%3Dempty%20resumed%3Dtrue
let ticker = Ticker.create (2 * Time.millisecond())
let ticks = Ticker.channel (ref ticker)

let t1 = Maybe.default_value 0 (Channel.recv ticks)
let t2 = Maybe.default_value 0 (Channel.recv ticks)

Ticker.stop (ref ticker)
let after_stop =
    match Channel.try_recv ticks with
    | Channel.Empty -> "empty"
    | _ -> "stale"

Ticker.reset (ref ticker) Time.millisecond()
let t3 = Maybe.default_value 0 (Channel.recv ticks)
Ticker.stop (ref ticker)

$"monotonic={t2 > t1} after_stop={after_stop} resumed={t3 >= t2}"
```

## `select` 式・`Context` との連携パターン

周期ワーカーをキャンセル可能に実装する際は、ループの前に `Ticker.channel` と `Context.done` を 1 回ずつ取得し、[`select` 式](../../concurrency/select.md) で待ち受けます。関数スコープを抜ける際に `ticker` が `Drop` されて自動停止します。

```tsuzuri run=ticks_ok%3Dtrue
def run_periodic :: unit -> bool
fn run_periodic _ =
    let root = Context.background ()
    let ctx = Context.with_cancel (ref root)
    let result_ch: Channel<i64> = Channel.make 1

    let worker_ctx = Context.share (ref ctx)
    let report = Channel.share result_ch
    tzroutine {
        let ticker = Ticker.create (2 * Time.millisecond())
        let ticks = Ticker.channel (ref ticker)
        let done = Context.done (ref worker_ctx)
        let mut count = 0i64
        let mut running = true
        while running do
            select
            | recv _ from ticks ->
                count = count + 1
                if count == 2 then Context.cancel (ref worker_ctx)
            | recv _ from done ->
                running = false
        Channel.send report count
    }

    let total = Maybe.default_value 0 (Channel.recv result_ch)
    total >= 2

$"ticks_ok={run_periodic ()}"
```

## リソース寿命・実行境界・対応ターゲット

- **`Drop` と境界終了時の自動停止**: `Timer` および `Ticker` は非 `Copy` の不透明所有型（直接構築・分解は `E1022`）であり、`Send` かつ `Sync` を満たします（通常の関数値への捕捉は `E1005`）。ハンドルが `Drop` されるとランタイム上のタイマー登録は即座に停止・解放されます。また `main`・`export`・`test`・`bench` の各実行境界は、完了時に未発火のタイマーや稼働中のティッカーを待機せず自動的に停止します。なお `Timer.stop` / `Ticker.stop` はチャネルを閉鎖（`close`）するわけではないため、`stop` 後にそのチャネルだけを単独で `recv` すると永久待機（デッドロック）になる点に注意してください（必ず `Context.done` や終了用チャネルと `select` で組み合わせます）。
- **対応ターゲット**: ネイティブ 5 環境、および `--wasm-feature jspi` を指定した `wasm32`（ホスト側の `setTimeout` と連携）で動作します。JSPI なしの WebAssembly では `E2000` となります。

## 引数の順序

`Timer` と `Ticker` はともにリソースハンドル（コンパイラ組み込みハンドル）の例外分類に属するため、`create` を除くすべての関数で操作対象のハンドル `ref Timer` または `ref Ticker` を**第1引数**に取ります（`Timer.reset (ref timer) duration`、`Ticker.reset (ref ticker) period`）。詳細は [引数の順序](../conventions.md) を参照してください。

## API リファレンス

### `Timer` モジュール（全 4 公開関数）

| 名前 | 種別 / 型シグネチャ | 説明 |
| --- | --- | --- |
| `Timer` | 型（不透明ハンドル、非 `Copy`, `Send`, `Sync`, `Drop`） | 単発タイマーハンドル（`Drop` 時に自動停止・解放） |
| `Timer.create` | `own i64 -> Timer` | 指定ナノ秒後に現在時刻を 1 回送信するタイマーを生成する（`0` 以下は即時発火） |
| `Timer.channel` | `ref Timer -> Channel<i64>` | 発火時刻を受信するチャネルのハンドルを返す（`Time.after_func` 由来では閉鎖済み空チャネル） |
| `Timer.stop` | `ref Timer -> bool` | タイマーを停止して未読時刻を破棄し、未発火だった場合は `true` を返す |
| `Timer.reset` | `ref Timer -> own i64 -> bool` | 未読時刻を破棄して現在から指定ナノ秒後に再設定し、稼働中だった場合は `true` を返す |

### `Ticker` モジュール（全 4 公開関数）

| 名前 | 種別 / 型シグネチャ | 説明 |
| --- | --- | --- |
| `Ticker` | 型（不透明ハンドル、非 `Copy`, `Send`, `Sync`, `Drop`） | 周期ティッカーハンドル（`Drop` 時に自動停止・解放） |
| `Ticker.create` | `own i64 -> Ticker` | 指定ナノ秒周期で現在時刻を送信するティッカーを生成する（`0` 以下はトラップ） |
| `Ticker.channel` | `ref Ticker -> Channel<i64>` | 周期時刻を受信するチャネルのハンドルを返す（ループ前に 1 回取得する） |
| `Ticker.stop` | `ref Ticker -> unit` | ティッカーを停止し、チャネル内の未読時刻を破棄する |
| `Ticker.reset` | `ref Ticker -> own i64 -> unit` | チャネル内の未読時刻を破棄し、現在を起点に新しい正の周期で再開する（`0` 以下はトラップ） |

## 関連項目

- [Time](../sys/time.md)
- [Channel](./channel.md)
- [Context](./context.md)
- [Owned](../memory/owned.md)
- [引数の順序](../conventions.md)
- [tzroutine](../../concurrency/tzroutine.md)
- [select 式](../../concurrency/select.md)
