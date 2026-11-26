# Routine

`Routine` は、軽量並行タスク（[`tzroutine`](../../concurrency/tzroutine.md)）の動的起動、構造化フォーク・ジョインによるスコープ共有、協調的な実行権譲渡、スケジューラ状態の照会、および OS スレッド固定を提供するコンパイラ組み込みモジュールです。

`Routine` は常時利用可能な予約モジュールであり、`std/` 配下のソースファイルを持たずコンパイラが直接解決します（同名のユーザーファイル `Routine.tz` は `E1011` になります）。

## 要点

- `Routine.go` は所有クロージャ `Owned.Function<unit, unit>` を新しい `tzroutine` 上で 1 回実行し、完了後にそのクロージャを破棄する。
- `Routine.scope shared count f` は `Sync` を満たす共有借用 `shared` を `count` 個の子 `tzroutine` へ同時に貸し出し、全タスク完了後に各結果をインデックス順の配列として返す構造化並行 API である。
- `Routine.yield ()` は現在の `tzroutine` の実行権をスケジューラへ協調的に譲渡し、実行待ちの他タスクへ処理機会を与える。
- `Routine.count`・`Routine.max_procs`・`Routine.cpu_count` で稼働タスク数・並列プロセッサ数 `P`（環境変数 `TSUZURI_MAXPROCS`）・論理 CPU 数を取得できる。
- `Routine.with_locked_thread` はコールバック実行中、現在の `tzroutine` を実行中の OS スレッドにピン留めする。スレッドアフィニティを要求する GUI や C ライブラリの呼び出しに用いる。
- いずれの操作も並行副作用を伴うため、`pure def` 内での使用は `E1029` で拒否される。

## タスクの起動と協調的譲渡（`Routine.go` / `Routine.yield`）

`tzroutine { ... }` 式がその場のブロックを起動するのに対し、`Routine.go` は引数やデータ構造で受け取った [`Owned.Function<unit, unit>`](../memory/owned.md) を新しい `tzroutine` として起動します。起動されたタスクは、それを開始した実行境界（`main`・`export` 呼び出し・`test`・`bench`）が終了する前にすべて完了待機されます。

```tsuzuri run=completed%3D4
def launch :: own Owned.Function<unit, unit> -> unit
fn launch job = Routine.go job

let done = Arc.new (Atomic.create 0i64)
for _i in 0 ..< 4 do
    let counter = Arc.share (ref done)
    launch (Owned.function (\() -> {
        let _prev = Atomic.fetch_add (Arc.get (ref counter)) 1i64;
        ()
    }))

while Atomic.load (Arc.get (ref done)) < 4i64 do
    Routine.yield ()

$"completed={Atomic.load (Arc.get (ref done))}"
```

### プリエンプションと `Routine.yield` が必要な場面

通常のネイティブ実行バイナリでは長時間計算を行う `tzroutine` も約 10 ms 周期でプリエンプトされますが、シグナルベースの横取りを行わない構成（Windows、`--emit object` / `shared`、`--backend fast`、`tsuzuri test` / `bench`）における関数呼び出しを含まない密なループや、WebAssembly（`--wasm-feature jspi`）の単一スレッド協調スケジューラでは、待機操作を含まない長時間ループの途中に `Routine.yield ()` を挿入して他タスクへ制御を譲ります。なお、`Mutex.with_lock` の保持中に `Routine.yield ()` を呼ぶことも可能です。

## 構造化並行スコープ（`Routine.scope`）

通常の `tzroutine { ... }` や `Routine.go` は呼び出し元より長く生存しうるため、スタック上の参照 `ref 's` を持ち込めません（`Arc` 等への格納が必要）。これに対し `Routine.scope shared count f` は、`count` 個の子 `tzroutine` すべての完了を呼び出し元で待機することが保証されているため、`Sync` を満たす任意の値への共有借用 `ref 's` をコピーなしで全子タスクへ安全に貸し出せます。

```tsuzuri run=parts%3D1225%2C1250%2C1275%2C1300%20sum%3D5050
def partial_sum :: ref [i64] -> i64 -> i64
fn partial_sum data lane =
    let mut acc = 0i64
    let mut idx = lane
    while idx < data.length do
        acc = acc + data[idx]
        idx = idx + 4
    acc

let values = new [i64](100, \i -> i + 1)
let parts = Routine.scope (ref values) 4 (\shared lane -> partial_sum shared lane)
$"parts={parts[0]},{parts[1]},{parts[2]},{parts[3]} sum={Array.sum (ref parts)}"
```

[Parallel](./parallel.md) のチャンク処理とは異なり、`Routine.scope` の各要素は独立した `tzroutine` としてスケジュールされるため、子タスク同士がチャネルや同期プリミティブで相互に待機し合う協調アルゴリズム（リング通信やバリア同期など）も `TSUZURI_MAXPROCS=1` を含めデッドロックなく動作します。

```tsuzuri run=6
let stages = new [Channel<i64>](6, \_i -> Channel.make 0)
let out = Routine.scope (ref stages) 6 (\chs idx ->
    if idx == 0 then {
        Channel.send (ref chs[1]) 1;
        Maybe.default_value 0 (Channel.recv (ref chs[0]))
    } else {
        let v = Maybe.default_value 0 (Channel.recv (ref chs[idx])) + 1;
        Channel.send (ref chs[(idx + 1) % chs.length]) v;
        v
    })
out[0]
```

### `Routine.scope` の検査規則

- **`shared` の `Sync` 要件**: 第1引数の型 `'s` は `Sync` を満たす必要があります（`Rc`・非 `copy` の `extern type`・`Owned.Function`・`Seq`・`Tensor.View` 等は `E1013` で拒否されます。配列スライスや `Tensor.View` をデータ並列チャンクで共有する場合は [`Parallel.for_each_chunk_with`](./parallel.md) を使用します）。また `'s` が関数値を含む場合は借用環境を持たないことが静的に証明できなければなりません（`E1013`）。
- **コールバックと戻り値の所有要件**: コールバック `f` 自体は外部の借用を捕捉できず（共有データは第1引数 `shared` 経由で受け取ります）、戻り値 `'a` は参照を含まない `Send` 所有値でなければなりません（`E1013`）。
- **直接完全適用**: `Routine.scope` は 3 引数をその場で直接渡して呼び出す必要があり、部分適用や関数値化はできません（`E1013`）。それ以外の `Routine.*` 関数は通常の関数値として扱えます。
- **境界値**: `count == 0` の場合は空配列を即座に返し、`count < 0` の場合は配列確保時にトラップします。なお、以前の `Task.scope` は `E1040` となり、`tsuzuri fix` で `Routine.scope` へ自動変換されます。

## OS スレッドへの固定（`Routine.with_locked_thread`）

通常の `tzroutine` はチャネル待機やスリープから復帰する際、別のワーカースレッド（M）へ移動して再開されることがあります。GUI ツールキットのメインスレッド API、OpenGL コンテキスト、スレッドローカルストレージ（TLS）に依存する C ライブラリなど、同一 OS スレッドからの継続呼び出しを要求する処理は `Routine.with_locked_thread` のコールバック内で実行します。

```tsuzuri run=pinned%20total%3D120%20procs_ok%3Dtrue
let ch: Channel<i64> = Channel.make 3
for i in 1i64 ..= 3 do
    let tx = Channel.share ch
    tzroutine {
        let result = Routine.with_locked_thread (\() -> {
            Routine.yield ();
            i * 20
        })
        Channel.send tx result
    }
let mut sum = 0i64
for _i in 1 ..= 3 do
    sum = sum + Maybe.default_value 0 (Channel.recv ch)
let procs_ok = Routine.max_procs () >= 1 && Routine.cpu_count () >= 1 && Routine.count () >= 1
$"pinned total={sum} procs_ok={procs_ok}"
```

- スレッド固定はコールバックが返るまでのスコープに限定され、入れ子呼び出しにも対応しています（解除忘れが起きないスコープ設計）。
- 固定中の `tzroutine` が待機に入るとその OS スレッドもスリープしますが、論理プロセッサ `P` は別スレッドへ引き渡されるため、`TSUZURI_MAXPROCS=1` であっても他の `tzroutine` の進行は妨げられません。

## WebAssembly での動作

- 既定の単一スレッド WebAssembly（`tzroutine` 未起動）では、`Routine.count ()`・`max_procs ()`・`cpu_count ()` はすべて `1` を返し、`Routine.yield ()` と `with_locked_thread` は単一実行のまま動作します。
- `Routine.go` または `Routine.scope` を含むプログラムを WebAssembly へ出力する場合は `--target wasm32 --wasm-feature jspi` が必要です（未指定時は `E2000`）。JSPI 有効時も実行スレッドは 1 本であるため `max_procs ()` と `cpu_count ()` は `1` となります。

## 引数の順序

`Routine.go`・`yield`・`count`・`max_procs`・`cpu_count`・`with_locked_thread` はいずれも 1 引数関数です。`Routine.scope` はコンパイラ組み込みの構造化並行プリミティブとして、共有コンテキスト `ref 's`、タスク数 `i64`、本体コールバック `(ref 's -> i64 -> 'a)` の順に受け取ります（[引数の順序](../conventions.md)）。

## API リファレンス

`Routine` モジュールの全 7 公開関数の一覧です。

| 関数 | 型シグネチャ | 説明 |
| --- | --- | --- |
| `Routine.go` | `own Owned.Function<unit, unit> -> unit` | 所有クロージャを新しい `tzroutine` で 1 回実行し、終了後に破棄する |
| `Routine.scope` | `(Sync<'s>, Send<'a>) => ref 's -> i64 -> (ref 's -> i64 -> 'a) -> ['a]` | 共有借用を `count` 個の子 `tzroutine` に貸し出し、全完了後に結果配列を返す（直接適用必須） |
| `Routine.yield` | `unit -> unit` | 現在のタスクの実行権をスケジューラ（非 `tzroutine` スレッドでは OS）へ譲渡する |
| `Routine.count` | `unit -> i64` | 現在生存している `tzroutine` 数に呼び出しスレッド分の `1` を加えた数を返す |
| `Routine.max_procs` | `unit -> i64` | `tzroutine` を同時実行する最大 OS スレッド数 `P` を返す（`TSUZURI_MAXPROCS`、既定は論理 CPU 数・上限 256） |
| `Routine.cpu_count` | `unit -> i64` | 利用可能なオンライン論理 CPU 数（`1` 以上）を返す |
| `Routine.with_locked_thread` | `(unit -> 'a) -> 'a` | コールバック実行中、現在の `tzroutine` を同一 OS スレッドに固定して戻り値を返す |

## 関連項目

- [Owned](../memory/owned.md)
- [Channel](./channel.md)
- [Parallel](./parallel.md)
- [WaitGroup](./waitgroup.md)
- [ErrGroup](./errgroup.md)
- [Anchor](../memory/anchor.md)
- [引数の順序](../conventions.md)
- [tzroutine](../../concurrency/tzroutine.md)
