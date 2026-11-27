# MainThread

`MainThread` は、`tzroutine` やホストのワーカースレッドで行った処理の結果を、プロセスのメインスレッド（UI スレッド）へ戻すためのコンパイラ組み込みモジュールです。所有クロージャをメインスレッドのディスパッチキューへ投入し、メインスレッドがキューを処理するときに 1 回だけ呼び出します。

`MainThread` は常時利用可能な予約モジュールであり、`std/` 配下のソースファイルを持たずコンパイラが直接解決します（同名のユーザーファイル `MainThread.tz` は `E1011` になります）。ビルドできるターゲットは macOS（`aarch64-apple-darwin`）だけです。

## 要点

- `MainThread.post f` は所有クロージャ `Owned.Function<unit, unit>` をメインスレッドで 1 回呼ぶよう予約してすぐに戻り、呼び出しの後にクロージャを破棄する。
- `MainThread.after d f` は少なくとも `d` ナノ秒後に同じことを行う（`d <= 0` のときは `post` と同じ）。
- `MainThread.is_current ()` は、呼び出したスレッドがプロセスのメインスレッドかどうかを返す。
- 投入した関数が呼ばれるのは、メインスレッドがメインのディスパッチキューを処理している間（`[NSApp run]`・`CFRunLoopRun`・`dispatch_main`）だけである。Tsuzuri の待機（`Channel.recv`・`Time.sleep`・境界終了時の待機）はキューを処理しない。
- `main`・`test`・`bench` の本体が返った時点で残っている投入は、呼ばれずに破棄される（捕捉した値の `Drop` は 1 回だけ実行される）。
- いずれの関数も `task` 効果を持つため、`pure def` 内での使用は `E1029` で拒否される。

## メインスレッドへの投入（`MainThread.post` / `MainThread.after`）

`Routine.go` と同じく、引数は `Owned.function` で作る所有クロージャです。捕捉できるのは `Send` を満たす所有値だけで（`Rc` などを捕捉すると `E1013`）、どのスレッド（`main`・`tzroutine`・ホストが呼び出したコールバック・`export` を呼んだホストのスレッド）からでも投入できます。メインスレッド自身から投入した場合も、その場では呼ばれません。

次の例は、`tzroutine` で処理を行い、結果の表示をメインスレッドへ戻します。メインスレッドは CoreFoundation の run loop を回し、最後の投入が run loop を止めます（ビルドには `--framework CoreFoundation` を指定します）。

```tsuzuri
@trusted
extern "CFRunLoopGetMain" def cf_run_loop_get_main :: unit -> i64

@trusted
extern "CFRunLoopRun" def cf_run_loop_run :: unit -> unit

@trusted
extern "CFRunLoopStop" def cf_run_loop_stop :: i64 -> unit

def report :: string -> unit = \label ->
    do! IO.writeln $"{label}: {MainThread.is_current ()}"
    ()

def main :: unit -> i32 = \() ->
    tzroutine {
        MainThread.post (Owned.function (\() -> report "posted on main"))
        MainThread.after (Time.millisecond() * 50) (Owned.function (\() -> {
            report "after on main";
            cf_run_loop_stop (cf_run_loop_get_main ())
        }))
    }
    cf_run_loop_run ()
    0
```

実行すると `posted on main: true` と `after on main: true` を出力して終了コード 0 で終わります。

### 呼ばれる順序と条件

- 同じスレッドからの `post` は、投入した順に呼ばれます（メインのキューは直列の FIFO です）。`after` は期限の順に呼ばれ、同じ期限どうしの順序は規定しません。
- 呼ばれるのは、メインスレッドがメインのディスパッチキューを処理しているときだけです。AppKit の `[NSApp run]`、`CFRunLoopRun`、`dispatch_main` のいずれでも処理されます。`main` が run loop を回さずに `Channel.recv` などで待機していると、投入は呼ばれません（`tzroutine` が投入の結果を待っている場合はデッドロックとして報告されます）。
- 投入した関数の中のトラップは、他のトラップと同じくプロセスを終了させます。

### 実行境界と破棄

投入した関数は、静的コールバック（[ネイティブ連携](../../compiler/native-interop.md)）と同じ境界の規則で呼ばれます。

- `main` の実行中に呼ばれた関数は `main` の境界に属し、その中で起動した `tzroutine` は `main` の終了時に待機されます。
- `main`・`test`・`bench` の本体が返った時点で残っている投入は、呼ばれずに投入した順で破棄されます。破棄は境界終了の待機より前に行われるため、捕捉した値の `Drop` が起動した `tzroutine` も待機の対象になります。それ以降の `post`・`after` は、呼び出したスレッドでその場で破棄されます。
- 飽和して到来しない期限（`i64` の最大値など）はキューに積まれず、境界終了時の破棄を待ちます。
- ライブラリ出力（`--emit object`・`shared`・`llvm`・`bitcode`）では境界終了時の破棄がなく、投入はプロセスの寿命の間残ります。ホストの run loop がそれを呼び出します。

## 現在のスレッドの判定（`MainThread.is_current`）

`MainThread.is_current ()` は、呼び出したスレッドがプロセスのメインスレッドであれば `true` を返します。`tzroutine` の本体や `Routine.with_locked_thread` のコールバックはワーカースレッドで実行されるため `false` になります（`Routine.with_locked_thread` が固定する先は呼び出した OS スレッドであり、メインスレッドへは移しません）。

## スレッド拘束ハンドルとの関係

`post`・`after` に `Owned.function (\() -> ...)` で直接渡した関数は、OS スレッドに拘束されたハンドル（`extern type local`）やメインスレッド専用のハンドル（`extern type main`・`extern class main`）に触れていてもかまいません。メインスレッドは 1 つの固定されたスレッドだからです。この位置では効果 `pinned`・`main_thread` が呼び出し側へ伝わらないため、`tzroutine` の中から UI のハンドルに触れる処理を投入できます。

```tsuzuri
extern type main Window

@trusted
extern "make_window" def make_window :: unit -> Window

@trusted
extern "close_window" def close_window :: own Window -> unit

def refresh :: unit -> unit = \() ->
    let window = make_window ()
    close_window window

def main :: unit -> i32 = \() ->
    tzroutine {
        // refresh はメインスレッド専用のハンドルに触れるが、投入先はメインスレッドなので受理される
        MainThread.post (Owned.function (\() -> refresh ()))
    }
    0
```

同じ `refresh` を `tzroutine { refresh () }` や `Routine.go`・`Time.after_func` で起動すると `E1013`（`main_thread_code_spawned`）になります。別の場所で作った `Owned.Function` の値を `post` に渡す形は、通常の関数値として検査されます（`E1013` `main_thread_function_value`）。ハンドルの宣言と検査の全体は [ネイティブ連携](../../compiler/native-interop.md) を参照してください。

## メインスレッドの規律

- **メインスレッドで待たない**: `main` やメインスレッドのコールバックの中で `Channel.recv`・`Time.sleep`・`WaitGroup.wait` を呼ぶと run loop が止まり、UI が固まります。重い処理は `tzroutine` で行い、結果を `MainThread.post` で戻します。
- **終了**: `[NSApp terminate:]` は最後に `exit()` を呼ぶため、境界終了時の待機も `Drop` も実行されません。`applicationShouldTerminate:` で終了を取り消し、run loop を止めて `main` を返す形にすると、起動済みの `tzroutine` の待機と破棄が通常どおり行われます。終わらない `tzroutine` は [`Context`](./context.md) で止めます。
- **周期処理**: UI の周期処理は `MainThread.after` を投入し直すか、ホストのタイマーを使います。[`Time.after_func`](../sys/time.md)・[`Timer`・`Ticker`](./timer.md) はワーカースレッドで発火します。
- **ホストのスレッドからの受け渡し**: ランタイムに参加していないホストのスレッド（GCD のワーカーや完了ハンドラー）から `tzroutine` へ値を渡すときは、[共有の `Anchor`](../memory/anchor.md) に `Channel` を入れて `Anchor.read_shared` で読みます。

## ターゲットと診断

| 状況 | 結果 |
| --- | --- |
| `tsuzuri check` | すべてのターゲットで受理 |
| macOS（`aarch64-apple-darwin`）の `build`・`run`・`test`・`bench` | 利用可能（libSystem の libdispatch を使用。追加のリンク指定は不要） |
| その他のネイティブターゲット | `E2002`（`platform_unsupported_api`）。`--emit llvm` は出力可能 |
| WebAssembly（`wasm32`・`wasm64`） | `E2000`（`wasm_main_thread_unsupported`） |
| `--trap-mode return`・`--freestanding` との併用 | `E2000`（`option_conflict`） |

## 引数の順序

`MainThread.post`・`MainThread.is_current` は 1 引数関数です。`MainThread.after d f` は [`Time.after_func d f`](../sys/time.md) と同じく、遅延時間 `d`（ナノ秒）の後に関数 `f` を取ります（[引数の順序](../conventions.md)）。

## 他言語との対応

| 言語 | 対応する機能 |
| --- | --- |
| Swift | `DispatchQueue.main.async { ... }`・`DispatchQueue.main.asyncAfter`、`Thread.isMainThread`。`@MainActor` に対応するのは `extern type main`・`extern class main` |
| Kotlin | `withContext(Dispatchers.Main) { ... }`・`Handler(Looper.getMainLooper()).post` |
| C# | `SynchronizationContext.Post`・`Dispatcher.BeginInvoke` |

結果を待つ同期の形（`MainThread.call` に相当するもの）はありません。メインスレッドから呼ぶとデッドロックするためで、結果が必要なときは `Channel` で受け取ります。

## API リファレンス

`MainThread` モジュールの全 3 公開関数の一覧です。

| 関数 | 型シグネチャ | 説明 |
| --- | --- | --- |
| `MainThread.post` | `own Owned.Function<unit, unit> -> unit` | 所有クロージャをメインスレッドで 1 回呼ぶよう予約し、呼び出し後に破棄する |
| `MainThread.after` | `i64 -> own Owned.Function<unit, unit> -> unit` | 指定ナノ秒以上経過した後にメインスレッドで 1 回呼ぶよう予約する（0 以下は `post` と同じ） |
| `MainThread.is_current` | `unit -> bool` | 呼び出したスレッドがプロセスのメインスレッドなら `true` を返す |

## 関連項目

- [Routine](./routine.md)
- [Owned](../memory/owned.md)
- [Anchor](../memory/anchor.md)
- [Time](../sys/time.md)
- [ネイティブ連携と C ABI](../../compiler/native-interop.md)
- [Objective-C 連携](../../compiler/objective-c.md)
- [対応プラットフォームとクロスコンパイル](../../compiler/platforms.md)
- [引数の順序](../conventions.md)
