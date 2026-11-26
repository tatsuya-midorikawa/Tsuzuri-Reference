# Semaphore

`Semaphore` は、総容量（上限重み）の範囲内で並行タスクのリソース獲得量を制限する重み付きセマフォです。同時実行タスク数のスロットリング（上限 `N` 並列への制御）だけでなく、メモリ使用量やバッチサイズなどタスクごとに消費コストが異なるリソースの流量制御を単一のプリミティブで表現できます。

`Semaphore` は名前を参照したプログラムにのみ読み込まれるオプトイン標準モジュールです。

## 要点

- `Semaphore.create capacity` で総容量 `capacity`（`0` 以上）の重み付きセマフォを生成する（負の容量はトラップ）。
- `Semaphore.acquire sem weight` は利用可能な残余容量が `weight` 以上になるまで呼び出し元の `tzroutine` を待機させて獲得し、`Semaphore.release sem weight` で獲得済みの重みを返却する。
- `Semaphore.try_acquire sem weight` は待機を行わず、その場で獲得できた場合は `true`、残余容量不足なら状態を変化させず `false` を返す。
- 負の重みや総容量を超える重みの要求、および獲得総量を超える過剰な `release` は即座にトラップとして検出される。
- ハンドルは参照カウント管理されており、`Semaphore.share` で複製して各 `tzroutine` へ配布する（最後のハンドルの `Drop` で解放）。

## 基本的な使い方

### ノンブロッキング獲得と重み付き制御

1 つのセマフォに対して異なる重み（コスト）の獲得・返却を行う例です。

```tsuzuri run=first%3Dtrue%20over%3Dfalse%20after_release%3Dtrue
let sem = Semaphore.create 4
let first = Semaphore.try_acquire (ref sem) 3
let over = Semaphore.try_acquire (ref sem) 2
Semaphore.release (ref sem) 2
let after_release = Semaphore.try_acquire (ref sem) 2
Semaphore.release (ref sem) 3
$"first={first} over={over} after_release={after_release}"
```

### 並行タスクの同時実行数制限

容量 `limit` のセマフォを作り、各タスクの開始時に重み `1` を `acquire`、完了時に `release` することで、同時にクリティカル領域へ入る `tzroutine` の数を最大 `limit` 個に抑えられます。

```tsuzuri run=completed%3D8%20within_bound%3Dtrue
def rec record_max :: ref Atomic<i64> -> i64 -> unit
fn rec record_max cell val =
    let cur = Atomic.load cell
    if val > cur then
        match Atomic.compare_exchange cell cur val with
        | Result.Ok _ -> ()
        | Result.Error _ -> record_max cell val

let gate = Semaphore.create 2
let active = Arc.new (Atomic.create 0i64)
let max_seen = Arc.new (Atomic.create 0i64)
let done = Arc.new (Atomic.create 0i64)
let wg = WaitGroup.create ()

for _i in 0 ..< 8 do
    let sem = Semaphore.share (ref gate)
    let act = Arc.share (ref active)
    let peak = Arc.share (ref max_seen)
    let fin = Arc.share (ref done)
    WaitGroup.go (ref wg) (Owned.function (\() -> {
        Semaphore.acquire (ref sem) 1;
        let now = Atomic.fetch_add (Arc.get (ref act)) 1 + 1;
        record_max (Arc.get (ref peak)) now;
        Routine.yield ();
        let _prev = Atomic.fetch_sub (Arc.get (ref act)) 1;
        Semaphore.release (ref sem) 1;
        let _d = Atomic.fetch_add (Arc.get (ref fin)) 1;
        ()
    }))

WaitGroup.wait (ref wg)
let peak_val = Atomic.load (Arc.get (ref max_seen))
$"completed={Atomic.load (Arc.get (ref done))} within_bound={peak_val <= 2}"
```

なお、`Result` を返すタスク群の同時実行数を制限しつつ最初のエラーを伝播したい場合は、`set_limit` を内蔵した [`ErrGroup`](./errgroup.md) を使うと `release` の書き忘れなく簡潔に記述できます。

## 起床順序・トラップ条件・ターゲット動作

- **起床と獲得順序**: `Semaphore.release` で重みが返却されると待機中のタスクが一斉に起床し、残余容量を満たせるタスクが重みを獲得します。厳密な FIFO（先着順）は保証しないため、軽い要求が重い待機要求より先に通ることがあります。
- **境界検査とトラップ条件**:
  - `Semaphore.create capacity` に `capacity < 0` を渡した場合、または `acquire` / `try_acquire` / `release` に `weight < 0` もしくは `weight > capacity` を渡した場合は、`Semaphore weight is negative or larger than its capacity` でトラップします（総容量を超える獲得要求は永久に満たされないため、デッドロックではなく即座にエラーとします）。
  - 現在獲得されている重みの合計を超えて `Semaphore.release` を呼び出した場合は、`Semaphore released more than it acquired` でトラップします。
  - `weight == 0` の獲得・返却は常に待機せず成功します。
- **ハンドルの所有権**: `Semaphore` は非 `Copy` の不透明ハンドル（直接構築・分解は `E1022`）であり、`Send` かつ `Sync` を満たします。再利用可能な関数値への捕捉は `E1005` となります。
- **対応ターゲット**: ネイティブ 5 環境、および `--wasm-feature jspi` を指定した `wasm32` で完全動作します。既定の単一スレッド WebAssembly では残余容量がある間の獲得・返却は動作し、`acquire` が待機に入った時点でトラップします。

## 引数の順序

`Semaphore` モジュールはリソースハンドル（コンパイラ組み込みハンドル）の例外分類に属するため、`acquire`・`try_acquire`・`release`・`share` は操作対象のセマフォハンドル `ref Semaphore` を**第1引数**に取ります（`Semaphore.acquire sem weight`）。詳細は [引数の順序](../conventions.md) を参照してください。

## API リファレンス

`Semaphore` モジュールの全 5 公開関数の一覧です。

| 名前 | 種別 / 型シグネチャ | 説明 |
| --- | --- | --- |
| `Semaphore` | 型（不透明ハンドル、非 `Copy`, `Send`, `Sync`, `Drop`） | 参照カウント管理される重み付きセマフォハンドル |
| `Semaphore.create` | `i64 -> Semaphore` | 指定した総容量（`0` 以上）を持つセマフォを生成する（負数はトラップ） |
| `Semaphore.acquire` | `ref Semaphore -> i64 -> unit` | 指定した重みが空くまで待機して獲得する（負数または容量超過はトラップ） |
| `Semaphore.try_acquire` | `ref Semaphore -> i64 -> bool` | 待機せず獲得を試み、獲得できれば `true`、不足なら `false` を返す |
| `Semaphore.release` | `ref Semaphore -> i64 -> unit` | 指定した重みを返却する（負数または獲得量超過はトラップ） |
| `Semaphore.share` | `ref Semaphore -> Semaphore` | 同じセマフォを指す新しい所有ハンドルを生成する |

## 関連項目

- [ErrGroup](./errgroup.md)
- [Cond](./cond.md)
- [WaitGroup](./waitgroup.md)
- [Mutex](./mutex.md)
- [引数の順序](../conventions.md)
- [tzroutine](../../concurrency/tzroutine.md)
