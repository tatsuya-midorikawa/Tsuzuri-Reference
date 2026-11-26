# Context

`Context` は、並行タスク階層にわたってキャンセル信号とデッドライン（制限時刻）を伝播するためのキャンセルコンテキスト（コンテキストツリー）です。`Context.background ()` をルートとし、`with_cancel`・`with_timeout`・`with_deadline` で子コンテキストを派生させることで、親から子孫方向への一括キャンセルとタイムアウト制御を構造的に管理できます。

`Context` は名前を参照したプログラムにのみ読み込まれるオプトイン標準モジュールです。

## 要点

- **協調的キャンセル**: Tsuzuri のランタイムは稼働中の `tzroutine` を外部から強制終了しない。キャンセル対象となるタスクは `Context.done` が返すチャネルを [`select` 式](../../concurrency/select.md) 等で監視し、チャネル閉鎖を検知して自ら終了処理を行う。
- **親から子孫への単方向伝播**: ある `Context` がキャンセルされると、その自身とすべての子孫コンテキストが一括でキャンセルされるが、親コンテキストはキャンセルされない。ルートである `Context.background ()` は決してキャンセルされない。
- **終了理由の不変性**: `Context.err` は未終了の間 `Maybe.None` を返し、終了後は最初の終了理由（手動キャンセルなら `Context.Canceled`、期限到達なら `Context.DeadlineExceeded`）を保持し続ける。
- **デッドラインの継承**: 子コンテキストに指定した期限よりも親コンテキストの期限の方が早い場合、子は自動的に親の早い期限を引き継ぐ。
- **キャンセル権限の分離**: `Context.share` は同じコンテキストを指すハンドルを複製するため複製先からも全体をキャンセルできる。子タスクに下流だけをキャンセルさせたい場合は `Context.with_cancel` で子コンテキストを作って渡す。

## 基本的な使い方：`select` による協調的キャンセル

実行境界（`main`・`export`・`test`・`bench`）は起動された全 `tzroutine` の完了を待機するため、バックグラウンドワーカーやストリーム生成ループは `Context.done` の閉鎖を監視して停止させます。

`Context.done` は呼び出すたびに内部チャネルの新しいハンドルを生成するため、**ループの外で 1 回だけ取得**して変数に束縛してください。

```tsuzuri run=collected%3D4%20reason%3DCanceled
let root = Context.background ()
let ctx = Context.with_cancel (ref root)
let stream: Channel<i64> = Channel.make 0

let worker_ctx = Context.share (ref ctx)
let tx = Channel.share stream
tzroutine {
    let done = Context.done (ref worker_ctx)
    let mut seq = 1i64
    let mut active = true
    while active do
        select
        | recv _ from done -> active = false
        | send seq to tx -> seq = seq + 1
}

let mut count = 0i64
for _i in 1 ..= 4 do
    match Channel.recv stream with
    | Maybe.Some _ -> count = count + 1
    | Maybe.None -> ()

Context.cancel (ref ctx)
let reason =
    match Context.err (ref ctx) with
    | Maybe.Some err -> $"{err}"
    | Maybe.None -> "none"
$"collected={count} reason={reason}"
```

## タイムアウト・デッドラインと親子階層

`Context.with_timeout parent duration_ns` は現在時刻から指定ナノ秒後、`Context.with_deadline parent deadline_ns` は単調増加クロック（`Time.monotonic_ns` と同一時間軸）の指定時刻を期限とする子コンテキストを生成します（これら 2 関数は時計を参照するため `time` 権限を使用します）。すでに過去の時刻を指定した場合は即座に `DeadlineExceeded` 状態の子が返ります。

```tsuzuri run=expired_err%3DDeadlineExceeded%20inherited%3Dtrue%20parent_alive%3Dtrue
let root = Context.background ()
let expired = Context.with_deadline (ref root) 0
let expired_err =
    match Context.err (ref expired) with
    | Maybe.Some why -> $"{why}"
    | Maybe.None -> "active"

let outer = Context.with_timeout (ref root) (10 * Time.second())
let inner = Context.with_timeout (ref outer) Time.hour()
let inherited =
    match (Context.deadline (ref outer), Context.deadline (ref inner)) with
    | (Maybe.Some d_out, Maybe.Some d_in) -> d_out == d_in
    | _ -> false

Context.cancel (ref inner)
let parent_alive = !(Context.is_done (ref outer))
Context.cancel (ref outer)
$"expired_err={expired_err} inherited={inherited} parent_alive={parent_alive}"
```

作業が期限より前に正常終了した場合も、`Context.cancel` を呼ぶか `Context` ハンドルをスコープ終了で破棄することで内部タイマー資源を速やかに手放せます。

## キャンセル時コールバックの登録（`after_func` / `stop_after`）

`Context.after_func ctx f` は、`ctx` がキャンセルされた時点で所有クロージャ `f`（[`Owned.Function<unit, unit>`](../memory/owned.md)）を新しい `tzroutine` 上で 1 回起動します（登録時点で既にキャンセル済みであれば即座に起動します）。

戻り値の `Context.AfterFunc` ハンドルに対して `Context.stop_after` を呼ぶと、まだコールバックが起動していなければ登録を解除して `true` を返し、すでに起動済みであれば `false` を返します。また `Context.AfterFunc` ハンドル自体が `Drop` された際も未実行のコールバックは自動的に解除されるため、コールバックを有効に保つ間は戻り値のハンドルを変数に保持してください。

```tsuzuri run=stopped_early%3Dtrue%20ran_on_cancel%3Dcleanup-done
let root = Context.background ()
let ctx = Context.with_cancel (ref root)

let early = Context.after_func (ref ctx) (Owned.function (\() -> ()))
let stopped_early = Context.stop_after (ref early)

let notify: Channel<string> = Channel.make 1
let tx = Channel.share notify
let _active_hook = Context.after_func (ref ctx) (Owned.function (\() ->
    Channel.send tx "cleanup-done"))

Context.cancel (ref ctx)
let msg = Maybe.default_value "none" (Channel.recv notify)
$"stopped_early={stopped_early} ran_on_cancel={msg}"
```

## 内部構造と対応ターゲット

- **深いツリーの反復キャンセル**: コンテキストツリーは反復アルゴリズムで子孫を走査してキャンセルするため、10 万段の深い階層であってもコールスタックを溢れさせずに安全にキャンセルできます。
- **不透明所有ハンドル**: `Context` と `Context.AfterFunc` はともに非 `Copy` の不透明型（直接構築・分解は `E1022`）であり、`Send` かつ `Sync` を満たします（通常の関数値への捕捉は `E1005`）。
- **対応ターゲット**: `Context` は `tzroutine` スケジューラのタイマー・チャネル機構上で動作するため、ネイティブ 5 環境および `--wasm-feature jspi` を指定した `wasm32` で動作します（JSPI なしの WebAssembly では `E2000`）。また実行境界の終了時には未発火のデッドラインタイマーや未実行の `after_func` が自動的に停止・解放されます。

## 引数の順序

`Context` モジュールはリソースハンドル（コンパイラ組み込みハンドル）の例外分類に属するため、`background` を除くすべての関数で操作対象のハンドル `ref Context`（`stop_after` では `ref Context.AfterFunc`）を**第1引数**に取ります（`Context.with_timeout (ref parent) duration`、`Context.after_func (ref ctx) f`）。詳細は [引数の順序](../conventions.md) を参照してください。

## API リファレンス

`std::Context` モジュールの型定義および全 12 公開関数の一覧です。

### 型定義

| 型 | 定義 / 説明 |
| --- | --- |
| `Context` | キャンセルとデッドラインを保持する参照カウント付きハンドル（不透明型、`Drop` 実装） |
| `Context.Error` | `Canceled \| DeadlineExceeded`（`Eq`, `Display` 実装） |
| `Context.AfterFunc` | `after_func` の登録ハンドル（`Drop` 時に未起動コールバックを自動解除） |

### 生成・派生・キャンセル操作

| 関数 | 型シグネチャ | 説明 |
| --- | --- | --- |
| `Context.background` | `own unit -> Context` | キャンセルもデッドラインも持たないルートコンテキストを生成する |
| `Context.with_cancel` | `ref Context -> Context` | 親の終了または自身の `cancel` で終了する子コンテキストを生成する |
| `Context.with_timeout` | `ref Context -> own i64 -> Context` | 現在から指定ナノ秒後（親の期限が早ければ親の期限）に `DeadlineExceeded` となる子を生成する |
| `Context.with_deadline` | `ref Context -> own i64 -> Context` | 単調増加クロックの指定時刻に `DeadlineExceeded` となる子を生成する |
| `Context.cancel` | `ref Context -> unit` | 自身と全子孫を `Canceled` で終了させる（既終了時および `background` に対しては無操作） |
| `Context.share` | `ref Context -> Context` | 同じコンテキストを指す新しい所有ハンドルを生成する |

### 状態照会と後処理フック

| 関数 | 型シグネチャ | 説明 |
| --- | --- | --- |
| `Context.done` | `ref Context -> Channel<unit>` | コンテキスト終了時に閉鎖される通知用チャネルのハンドルを返す（要素は送信されない） |
| `Context.err` | `ref Context -> Maybe<Context.Error>` | 未終了なら `None`、終了済みなら最初の終了理由を `Some` で返す |
| `Context.is_done` | `ref Context -> bool` | コンテキストが終了済み（`err` が `Some`）であれば `true` を返す |
| `Context.deadline` | `ref Context -> Maybe<i64>` | デッドラインが設定されていれば単調増加クロック時刻を `Some` で返す |
| `Context.after_func` | `ref Context -> own Owned.Function<unit, unit> -> Context.AfterFunc` | コンテキスト終了時に新しい `tzroutine` で 1 回実行する関数を登録する |
| `Context.stop_after` | `ref Context.AfterFunc -> bool` | 登録した関数が未起動なら解除して `true` を返し、起動済みなら `false` を返す |

## 関連項目

- [ErrGroup](./errgroup.md)
- [Channel](./channel.md)
- [Timer と Ticker](./timer.md)
- [Owned](../memory/owned.md)
- [Time](../sys/time.md)
- [引数の順序](../conventions.md)
- [tzroutine](../../concurrency/tzroutine.md)
- [select 式](../../concurrency/select.md)
