# Time

`Time` は、単調増加時計（モノトニック時計）・システム壁時計（UNIX 時刻）・スリープの `IO` アクションと、`tzroutine` スケジューラと連携するタイマー・時間単位組み込み関数を提供する標準モジュールです。

時計の読み取りやタイマー・スリープにはパッケージ権限 `time` が必要であり、いずれも `os` 効果を持つため `pure def` からは呼び出せません。手動で停止・リセットできるタイマーハンドルについては [`Timer` と `Ticker`](../sync/timer.md) も併せて参照してください。

## 要点

- 経過時間の計測には決して逆行しない `Time.monotonic_ns ()` の差分を用い、現在日時の取得には `Time.unix_ns ()` を用います。
- `Time.monotonic_ns`・`Time.unix_ns`・`Time.sleep_ms` は `std/Time.tz` で定義された遅延 `IO<Result<..., Os.Error>>` アクションです。
- `Time.sleep`・`Time.after`・`Time.tick`・`Time.after_func` および時間単位関数（`Time.millisecond()` など）はコンパイラ組み込みであり、呼び出した時点で直接動作します。
- `tzroutine` の内部では `Time.sleep` と `Time.sleep_ms` のどちらも OS スレッドをブロックせず、呼び出した tzroutine のみを待機させます。
- `main`・`export`・`test`・`bench` の終了境界では、未発火のタイマーを待たずに停止・解放します。

## モノトニック時計とシステム時計による計測

- **`Time.monotonic_ns ()`**: 任意の未規定な起点から単調増加するナノ秒を返します。NTP 補正やシステム時刻の手動変更で逆行しないため、処理時間やタイムアウトの計測には必ず 2 回の読み取り値の差（`after - before`）を使用します。`IO` アクションは構築時ではなく `let!` で実行した瞬間の時刻を読むため、計測対象の前後それぞれで `let!` を実行します。
- **`Time.unix_ns ()`**: `1970-01-01T00:00:00Z`（UNIX エポック）からの経過ナノ秒を返します。システム時計の変更により値が前後しうる壁時計であり、`i64` の表現範囲を超える時刻では `Os.ErrorKind.Other` エラーとなります（[`File.Metadata`](./file.md) の `modified_ns` が範囲外を飽和丸めするのとは異なります）。
- **`Time.sleep_ms ms`**: 指定ミリ秒以上待機します。`0` は待機せず即座に `Ok ()` を返し、負の値は `InvalidInput` エラーを返します。

```tsuzuri run=true%0Aslept-zero%0Atrue%0Ainvalid%20input
def main :: unit -> i32 = \() ->
    let! before = Time.monotonic_ns ()
    let! slept = Time.sleep_ms 0
    let! after = Time.monotonic_ns ()
    let! wall = Time.unix_ns ()
    let! negative = Time.sleep_ms (-1)
    do! IO.writeln (match (before, after) with
        | (Result.Ok t0, Result.Ok t1) -> $"{t1 - t0 >= 0}"
        | _ -> "clock-error")
    do! IO.writeln (if Result.is_ok (ref slept) then "slept-zero" else "failed")
    do! IO.writeln (match wall with
        | Result.Ok ns -> $"{ns > 0}"
        | Result.Error _ -> "wall-error")
    do! IO.writeln (match negative with
        | Result.Ok _ -> "unexpected"
        | Result.Error error -> Os.message error)
    0
```

精密なマイクロベンチマークの統計計測には、単発の `monotonic_ns` 差分ではなく較正・ウォームアップ・最適化防止を備えた [`Bench`](../testing/bench.md) と `tsuzuri bench` を使用してください。

## 時間単位組み込みと `tzroutine` タイマー

`Time` には Go の `time` パッケージに対応するナノ秒単位（`i64`）の時間定数関数とタイマー組み込みも用意されています。時間単位関数は引数 0 個の組み込み関数（`fn() -> i64`）であるため、`Time.millisecond()` のように空白を入れず `()` を付けて呼び出します（空白を入れて `Time.millisecond ()` と書くと `unit` 引数 1 個の呼び出しと解釈され `E1006` になります）。

| 組み込み関数 | 値（ナノ秒 `i64`） |
| --- | --- |
| `Time.nanosecond()` | `1` |
| `Time.microsecond()` | `1_000` |
| `Time.millisecond()` | `1_000_000` |
| `Time.second()` | `1_000_000_000` |
| `Time.minute()` | `60_000_000_000` |
| `Time.hour()` | `3_600_000_000_000` |

### スリープ・タイムアウト・周期実行・遅延呼び出し

- **`Time.sleep d`**: 少なくとも `d` ナノ秒待機します（`d <= 0` のときは `Routine.yield` と同様に 1 回実行権を譲ります）。
- **`Time.after d`**: `d` ナノ秒後に発火時点の単調時計ナノ秒を 1 回だけ送信する容量 1 の `Channel<i64>` を返します。[`select`](../../concurrency/select.md) のアームに指定することでタイムアウトを簡潔に記述できます（`select` のアームには一時式を直接書けないため、一度 `let` 変数に束縛してから渡します）。
- **`Time.tick d`**: `d` ナノ秒周期で単調時計ナノ秒を送る容量 1 の `Channel<i64>` を返します（受信側が前回の値を受け取っていなければその周期の送信は破棄されます。返されたチャンネルの全ハンドルがドロップされると自動的に停止します。`d <= 0` はトラップします）。
- **`Time.after_func d f`**: `d` ナノ秒後に `Owned.Function<unit, unit>` を新しい tzroutine 上で 1 回実行する [`Timer`](../sync/timer.md) を返します。

`Time.after`・`Time.tick` を参照すると自動的に `Channel` モジュールが、`Time.after_func` を参照すると自動的に `Timer` モジュールがロードされます。

```tsuzuri run=timeout%0Atrue%0Acalled
def main :: unit -> i32 = \() ->
    let idle: Channel<i64> = Channel.make 0
    let deadline = Time.after (15 * Time.millisecond())
    let outcome =
        select
        | recv _ from idle -> "received"
        | recv _ from deadline -> "timeout"
    do! IO.writeln outcome

    let ticks = Time.tick (2 * Time.millisecond())
    let first = Channel.recv ticks
    let second = Channel.recv ticks
    do! IO.writeln (match (first, second) with
        | (Maybe.Some t0, Maybe.Some t1) -> $"{t1 > t0}"
        | _ -> "false")

    let done: Channel<i64> = Channel.make 1
    let notify = Channel.share done
    let _timer = Time.after_func (5 * Time.millisecond()) (Owned.function (\() -> Channel.send notify 1))
    do! IO.writeln (match Channel.recv done with
        | Maybe.Some _ -> "called"
        | Maybe.None -> "missed")
    0
```

## 対応環境

- **ネイティブ（Linux・macOS・Windows）**: Linux は `clock_gettime`、macOS は `clock_gettime` / `mach_absolute_time`、Windows は `QueryPerformanceCounter`（単調時計）と `GetSystemTimePreciseAsFileTime`（壁時計）で動作します。なお `Time.sleep` やタイマー群は tzroutine スケジューラを使用するため、`--trap-mode return` とは併用できません（`E2000`）。
- **WebAssembly / WASI**:
  - `monotonic_ns`・`unix_ns`・`sleep_ms` は既定の `wasm32` では `E2000` となり、`--wasm-host wasi` 指定時に WASI の時計・ポーリング API へコンパイルされます。
  - `Time.after`・`Time.tick`・`Time.after_func`（および tzroutine 内の `Time.sleep`）は `wasm32` では `--wasm-feature jspi` が必要です（[WebAssembly](../../compiler/webassembly.md)）。

## 引数の順序

`std/Time.tz` の公開関数 3 つはいずれも単一引数（`unit` またはミリ秒数 `i64`）を取ります。組み込みの `Time.after_func d f` は Go の `time.AfterFunc(d, f)` に合わせ、遅延時間 `d` の後にコールバック `f` を取ります（[標準ライブラリの規約](../conventions.md)）。

## 公開 API

### 標準ライブラリ関数（`std/Time.tz`、3 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Time.monotonic_ns` | `own unit -> IO<Result<i64, Os.Error>>` | 逆行しない単調増加時計のナノ秒を取得（差分計測用） |
| `Time.unix_ns` | `own unit -> IO<Result<i64, Os.Error>>` | `1970-01-01T00:00:00Z` からの経過ナノ秒を取得（範囲外は `Other`） |
| `Time.sleep_ms` | `own i64 -> IO<Result<unit, Os.Error>>` | 指定ミリ秒以上待機（`0` は即復帰、負値は `InvalidInput`） |

### コンパイラ組み込み（タイマー・時間単位、10 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Time.sleep` | `i64 -> unit` | 指定ナノ秒以上待機（tzroutine 内では当該 tzroutine のみ待機） |
| `Time.after` | `i64 -> Channel<i64>` | 指定ナノ秒後に時刻を 1 回送信する容量 1 のチャンネルを生成 |
| `Time.tick` | `i64 -> Channel<i64>` | 指定ナノ秒周期で時刻を送信するチャンネルを生成（`<= 0` はトラップ） |
| `Time.after_func` | `i64 -> Owned.Function<unit, unit> -> Timer` | 指定ナノ秒後に関数を新しい tzroutine で 1 回呼び出すタイマーを生成 |
| `Time.nanosecond` | `fn() -> i64` | `1` ナノ秒（`Time.nanosecond()` として呼ぶ） |
| `Time.microsecond` | `fn() -> i64` | `1_000` ナノ秒 |
| `Time.millisecond` | `fn() -> i64` | `1_000_000` ナノ秒 |
| `Time.second` | `fn() -> i64` | `1_000_000_000` ナノ秒 |
| `Time.minute` | `fn() -> i64` | `60_000_000_000` ナノ秒 |
| `Time.hour` | `fn() -> i64` | `3_600_000_000_000` ナノ秒 |

## 関連項目

- [IO](./io.md)
- [Os](./os.md)
- [Timer と Ticker](../sync/timer.md)
- [Channel](../sync/channel.md)
- [Owned](../memory/owned.md)
- [Bench](../testing/bench.md)
- [標準ライブラリの規約](../conventions.md)
- [tzroutine](../../concurrency/tzroutine.md)
- [select 式](../../concurrency/select.md)
- [WebAssembly](../../compiler/webassembly.md)
