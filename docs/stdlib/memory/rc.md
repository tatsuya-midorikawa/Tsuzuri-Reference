# Rc と Arc

`Rc<'a>` と `Arc<'a>` は、単一のヒープ値を複数の所有者で共有する参照カウントスマートポインタです。Tsuzuri はガベージコレクタを持たず、`Rc.share` または `Arc.share` を明示的に呼び出したときだけ参照カウントが増加し、最後の強参照がスコープを抜けた時点で即座に値が破棄されます。

単一の `tzroutine` 内で完結する永続データ構造や DAG（有向非巡回グラフ）の共有には非アトミックで軽量な `Rc<'a>` を用い、複数の `tzroutine` や OS スレッド間で値を共有する場合にはアトミック命令でカウントを更新する `Arc<'a>` を用います。

## 要点

- `Rc<'a>` と `Arc<'a>` は非 `Copy` の所有型であり、代入や値渡しはムーブとなる（ムーブ後の使用は `E1012`）。所有者を増やす操作は `Rc.share` / `Arc.share` に統一されている。
- 格納された値へは `Rc.get` / `Arc.get` による共有借用 `ref 'a` でのみアクセスできる。共有中の状態を変更する場合は `Arc<Atomic<T>>` や `Arc<Mutex<T>>` のように内部可変性を持つ同期型を組み合わせる。
- 弱参照 `Rc.Weak<'a>` / `Arc.Weak<'a>` は値の生存期間を延ばさない。`Rc.upgrade` / `Arc.upgrade` により、値が生存していれば `Maybe.Some` で強参照を再取得し、解放済みであれば `Maybe.None` を得る。
- `Rc<'a>` は `Send` も `Capture` も満たさないため、他の `tzroutine` への移動（`E1013`）や関数値への捕捉（`E1005`）はできない。`Arc<'a>` は `'a` が `Send` かつ `Sync` のときに `Send` となり、`'a` が `Sync` のときに関数値へ捕捉できる。
- `Rc` / `Arc` 単体では共有後の書き換えができないため参照循環を作れない。`Arc` と `Mutex` 等を組み合わせる場合は親子の一方を `Arc.Weak` にするか、世代付きハンドルで管理する [Arena](./arena.md) を選択する。
- 再帰型を含む深い連結構造の解放は反復的な待機リストで処理されるため、100 万要素規模の鎖でもコールスタックを消費しない。

## 基本的な使い方

`Rc.new` で値をヒープブロックへ移動し、`Rc.share` で同じブロックを指す新たな強参照を生成します。`Rc.get` は格納値への共有借用 `ref 'a` を返し、その借用が有効な間は元の `Rc` をムーブできません。

```tsuzuri run=len%3D14%20strong%3D2%20same%3Dtrue
let primary = Rc.new "immutable data"
let replica = Rc.share (ref primary)
let view = Rc.get (ref replica)
let len = view.length
let strong = Rc.strong_count (ref primary)
let same = Rc.ptr_eq (ref primary) (ref replica)
$"len={len} strong={strong} same={same}"
```

`Rc.ptr_eq` は値の等価性ではなく、2 つのハンドルが同一のヒープブロックを指しているか（ポインタ同一性）を判定します。`Rc<'a>` および `Arc<'a>` 自体には `Eq`・`Ord`・`Hash`・`Display` のインスタンスは定義されていないため、値の比較や文字列化は `Rc.get` / `Arc.get` で借用した中身に対して行います。

### 永続データ構造における末尾の共有

組み込みリスト `[|'a|]` は単一所有であり末尾を共有しません。複数のリスト間で共通の末尾ノードを共有する永続リストは、共用体と `Rc` を組み合わせて表現します。

```tsuzuri run=left%3D105%20right%3D205%20tail_refs%3D3
union SharedList = Nil | Cons of (i64 * Rc<SharedList>)

def rec sum_list :: ref Rc<SharedList> -> i64
fn rec sum_list node =
    match Rc.get node with
    | Cons (head, tail) -> head + sum_list tail
    | Nil -> 0

let common_tail = Rc.new (Cons (2, Rc.new (Cons (3, Rc.new Nil))))
let left = Rc.new (Cons (100, Rc.share (ref common_tail)))
let right = Rc.new (Cons (200, Rc.share (ref common_tail)))
$"left={sum_list (ref left)} right={sum_list (ref right)} tail_refs={Rc.strong_count (ref common_tail)}"
```

### 単独所有時の値の取り出し（`try_unwrap`）

`Rc.try_unwrap`（および `Arc.try_unwrap`）は、強参照カウントが `1` の場合に限りヒープブロックから所有値を `Result.Ok` として取り出します。他の強参照が残っている場合は、渡したハンドルをそのまま `Result.Error` に包んで返します。

```tsuzuri run=shared%3D2%20unwrapped%3D9
let first = Rc.new "sole copy"
let second = Rc.share (ref first)
let step1 =
    match Rc.try_unwrap first with
    | Result.Ok text -> text.length
    | Result.Error returned -> Rc.strong_count (ref returned)
let step2 =
    match Rc.try_unwrap second with
    | Result.Ok text -> text.length
    | Result.Error returned -> Rc.strong_count (ref returned)
$"shared={step1} unwrapped={step2}"
```

1 回目の `try_unwrap` では `second` が生存しているため `Result.Error` が返り、`returned` がアーム終端で破棄された時点で所有者が `second` のみになります。その結果、2 回目の `try_unwrap` では所有値をムーブで回収できます。

## 弱参照（`Weak`）とアップグレード

`Rc.downgrade` / `Arc.downgrade` は、強参照カウントを増やさない弱参照 `Rc.Weak<'a>` / `Arc.Weak<'a>` を生成します。すべての強参照が破棄された時点で格納値のデストラクタが走り、それ以降の `upgrade` は `Maybe.None` を返します。カウント管理用のヘッダ領域自体は、最後の弱参照が破棄された時点で解放されます。

```tsuzuri run=alive%3D60%20weak%3D1%20expired%3D-1
let numbers = Rc.new [10, 20, 30]
let observer = Rc.downgrade (ref numbers)
let weak_n = Rc.weak_count (ref numbers)
let alive =
    match Rc.upgrade (ref observer) with
    | Maybe.Some strong -> Array.sum (Rc.get (ref strong))
    | Maybe.None -> -1
Owned.drop numbers
let expired =
    match Rc.upgrade (ref observer) with
    | Maybe.Some strong -> Array.sum (Rc.get (ref strong))
    | Maybe.None -> -1
$"alive={alive} weak={weak_n} expired={expired}"
```

## `Arc` による並行タスク間の状態共有

`Arc<'a>` は `Rc<'a>` と同一の関数群を備え、参照カウントの増減をアトミックに行います。大きな読み取り専用配列を複製せずに複数の `tzroutine` へ配布する場面や、`Arc<Atomic<T>>`・`Arc<Mutex<T>>` で共有状態を保護する場面で使用します。

```tsuzuri run=even%3D2450%20odd%3D2500%20owners%3D1
def stride_sum :: ref [i64] -> i64 -> i64
fn stride_sum xs start =
    let mut acc = 0
    let mut i = start
    while i < xs.length do
        acc = acc + xs[i]
        i = i + 2
    acc

def spawn_worker :: own Arc<[i64]> -> i64 -> own Channel<i64> -> unit
fn spawn_worker data offset out =
    tzroutine {
        let partial = stride_sum (Arc.get (ref data)) offset
        Owned.drop data
        Channel.send out partial
    }

let table = Arc.new (new [i64](100, \i -> i))
let results: Channel<i64> = Channel.make 2
spawn_worker (Arc.share (ref table)) 0 (Channel.share results)
spawn_worker (Arc.share (ref table)) 1 (Channel.share results)
let first = Maybe.default_value 0 (Channel.recv results)
let second = Maybe.default_value 0 (Channel.recv results)
let lo = Int.min first second
let hi = Int.max first second
$"even={lo} odd={hi} owners={Arc.strong_count (ref table)}"
```

各ワーカーが結果を送信する前に `Owned.drop` で自分の `Arc` を解放しているため、主処理が 2 件の結果を受け取った時点では `strong_count` が確実に `1` に戻っています。解放時は `release` 加算と `acquire` フェンスにより、他スレッド上のあらゆる読み取りが完了した後にのみデストラクタが実行されます。

## `Send`・`Sync`・クロージャ捕捉の条件

`Rc` と `Arc` では、並行境界を越える移動（`Send`）および再利用可能な関数値への捕捉（`Capture`）の条件が明確に分かれています。

| 型 | 所有者の複製 | `Send`（他 `tzroutine` / スレッドへの移動） | 関数値への捕捉（`Capture`） |
| --- | --- | --- | --- |
| `Rc<'a>` / `Rc.Weak<'a>` | `Rc.share` / `Rc.downgrade` | 不可（`E1013`） | 不可（`E1005`） |
| `Arc<'a>` / `Arc.Weak<'a>` | `Arc.share` / `Arc.downgrade` | `'a: Send` かつ `'a: Sync` | `'a: Sync` |

- `Rc` の参照カウントは非アトミックであるため、生成元の `tzroutine` の外へ持ち出せません。また Tsuzuri の通常の関数値（`'a -> 'b`）はすべて `Send` として扱われるため、`Rc` をクロージャや `Owned.function` に捕捉することも禁止されています（`E1005`）。
- `Arc<'a>` を持つ複数の `tzroutine` は同時に `Arc.get` で `ref 'a` を取得できるため、`Arc<'a>` が `Send` となるには `'a` が `Send` と `Sync` の双方を満たす必要があります。`Rc`、非 `copy` の `extern type`、非 `Copy` の `dyn` 値、`Owned.Function`、排他参照 `ref mut`、`Seq`、GPU ハンドルを含む型は `Sync` ではありません。一方、`Atomic<T>` や `Mutex<T>`（`T: Send`）は `Sync` を満たすため、`Arc<Atomic<T>>` や `Arc<Mutex<T>>` は安全に他 `tzroutine` へ送信できます。
- `Arc` を捕捉した通常の関数値がコピーされる際は、格納値のディープコピーではなく `Arc.share` と同等のアトミックな参照カウント加算が行われます。
- `Rc` / `Arc` の型引数に排他参照 `ref mut` を指定することはできません（`E1005`）。共有参照 `ref T` を格納した `Rc<ref T>` は参照元の生存期間を超えて生存できません（`E1013`）。また C ABI 境界（`export def` / `extern def`）では `E1008`、`const` 束縛では `E1026` となります。

### `share` / `downgrade` / `upgrade` と借用追跡

`Rc.get`（および `Arc.get`）の戻り値 `ref 'a` は引数ハンドルへの借用を保持しますが、`share`・`downgrade`・`upgrade` の戻り値はヒープブロックの独立した所有者です。関数内で生成した `Rc` / `Arc` を `share` した場合、引数の借用は呼び出し完了とともに終了するため、複製を持ったまま元のハンドルをムーブ・破棄できます。

```tsuzuri run=42
let original = Rc.new (\x -> x + 2)
let cloned = Rc.share (ref original)
let moved = original
(deref (Rc.get (ref cloned))) 40 + Rc.strong_count (ref moved) - 2
```

ただし、格納値自体が外部変数の借用を保持している場合（例: `ref text` を捕捉したクロージャを包む `Arc`）は、複製されたハンドルもその借用を引き継ぎます。また、仮引数として受け取った `Rc<'a>` のように呼び出し元由来の借用を静的に否定できない値や、コールバック・`Mutex` 等を介して借用が注入されうる文脈では、安全のため元のハンドルの借用が維持されます。

## 循環参照の回避と `Arena` との使い分け

`Rc` や `Arc` 単体では格納値を後から書き換えられないため、構築時に循環参照が生じることはありません。ただし `Arc` の内部に `Mutex` や `RwMutex` を配置すると、後から相互参照を書き込んで強参照のサイクルを作ることができます。Tsuzuri にはサイクルコレクタがないため、強参照が循環したブロックは解放されません。

双方向リンクを持つ木構造などで親への逆参照が必要な場合は、親から子へは強参照（`Rc` / `Arc`）、子から親へは弱参照（`Rc.Weak` / `Arc.Weak`）とすることで所有の向きを一方向に保ちます。

```tsuzuri run=before%3D10%20after%3D-1
record TreeNode {
    id: i64,
    parent: Maybe<Arc.Weak<TreeNode>>,
    children: Mutex<Vec<Arc<TreeNode>>>,
}

def parent_id :: ref Arc<TreeNode> -> i64
fn parent_id node =
    match (Arc.get node).parent with
    | Maybe.Some weak ->
        match Arc.upgrade weak with
        | Maybe.Some p -> (Arc.get (ref p)).id
        | Maybe.None -> -1
    | Maybe.None -> 0

let root = Arc.new (TreeNode { id: 10, parent: Maybe.None, children: Mutex.create (Vec.empty()) })
let leaf = Arc.new (TreeNode { id: 20, parent: Maybe.Some (Arc.downgrade (ref root)), children: Mutex.create (Vec.empty()) })
let leaf_ref = ref leaf
Mutex.with_lock (ref (Arc.get (ref root)).children) (\kids -> {
    let prev = Vec.empty();
    deref kids = Vec.push_owned (Arc.share leaf_ref) prev
})
let before = parent_id (ref leaf)
Owned.drop root
$"before={before} after={parent_id (ref leaf)}"
```

任意の有向グラフや双方向連結リストのように、親子の上下関係が定まらない構造やノードの追加・削除が頻繁に発生する構造では、`Arc` + `Mutex` よりも世代付きハンドルを用いる [Arena](./arena.md) が適しています。

| 観点 | `Rc<'a>` / `Arc<'a>` | `Arena<'a>` + `Arena.Handle<'a>` |
| --- | --- | --- |
| 所有モデル | 値ごとの分散共有所有 | コンテナによる一括所有＋`Copy` ハンドル |
| 任意グラフ・循環 | 強参照のみでは不可（`Mutex` + `Weak` が必要） | ハンドル同士で自由に相互参照でき、一括 `Drop` で確実に解放 |
| 値の更新 | 不変（変更には `Mutex` / `Atomic` が必要） | `Arena.update` / `Arena.remove` で $O(1)$ 更新・削除 |
| 適した用途 | 永続データ構造、読み取り専用データの共有、並行状態の共有 | グラフ、AST、ECS、双方向リスト、キャッシュ |

## 引数の順序

`Rc` および `Arc` はリソースハンドル（コンパイラ組み込みハンドル）の例外分類に属するため、操作対象のハンドルを**第1引数**に取ります（`Rc.ptr_eq left right` 等）。標準ライブラリ全体の規則と例外分類は [引数の順序](../conventions.md) を参照してください。

## API リファレンス

以下の表は `Rc` モジュールの全公開関数です。`Arc` モジュールにも、`Rc` を `Arc`（`Rc.Weak` を `Arc.Weak`）に置き換えた同一シグネチャの 9 関数が提供されています。

### 生成・複製・参照取得

| 関数 | 型シグネチャ | 説明 |
| --- | --- | --- |
| `Rc.new` / `Arc.new` | `'a -> Rc<'a>` / `'a -> Arc<'a>` | 所有値を新しい参照カウントブロックへ格納して返す |
| `Rc.share` / `Arc.share` | `ref Rc<'a> -> Rc<'a>` / `ref Arc<'a> -> Arc<'a>` | 強参照カウントを 1 増やし、同じブロックを指す新しい所有ハンドルを返す |
| `Rc.get` / `Arc.get` | `ref Rc<'a> -> ref 'a` / `ref Arc<'a> -> ref 'a` | 格納されている値への共有借用を返す |
| `Rc.try_unwrap` / `Arc.try_unwrap` | `Rc<'a> -> Result<'a, Rc<'a>>` / `Arc<'a> -> Result<'a, Arc<'a>>` | 強参照カウントが `1` なら所有値を `Ok` で取り出し、他にあれば元のハンドルを `Error` で返す |

### 弱参照とカウント・同一性検査

| 関数 | 型シグネチャ | 説明 |
| --- | --- | --- |
| `Rc.downgrade` / `Arc.downgrade` | `ref Rc<'a> -> Rc.Weak<'a>` / `ref Arc<'a> -> Arc.Weak<'a>` | 値の寿命を延ばさない弱参照を生成する |
| `Rc.upgrade` / `Arc.upgrade` | `ref Rc.Weak<'a> -> Maybe<Rc<'a>>` / `ref Arc.Weak<'a> -> Maybe<Arc<'a>>` | 値が生存していれば強参照を `Some` で返し、解放済みなら `None` を返す |
| `Rc.strong_count` / `Arc.strong_count` | `ref Rc<'a> -> i64` / `ref Arc<'a> -> i64` | 現在の強参照の数を返す |
| `Rc.weak_count` / `Arc.weak_count` | `ref Rc<'a> -> i64` / `ref Arc<'a> -> i64` | 現在の弱参照（`Weak`）の数を返す |
| `Rc.ptr_eq` / `Arc.ptr_eq` | `ref Rc<'a> -> ref Rc<'a> -> bool` / `ref Arc<'a> -> ref Arc<'a> -> bool` | 2 つのハンドルが同一のヒープブロックを指しているかを判定する |

### ランタイム表現と境界条件

- ヒープ確保は `new` 呼び出し時の 1 回のみで、`{ strong_count, weak_count, value }` が単一ブロックに配置されます（再帰型を含む場合は反復解放用の 16 バイトヘッダが付加されます）。
- 参照カウントが `i64` の最大値を超過した場合はオーバーフローせずトラップします。
- 既定の単一スレッド WebAssembly ターゲットでは `Arc` のアトミック命令は通常命令へ降格され、`--wasm-feature threads` 指定時は WebAssembly アトミック命令が出力されます（ホスト import は追加されません）。

## 関連項目

- [Arena](./arena.md)
- [Owned](./owned.md)
- [Atomic](../sync/atomic.md)
- [Mutex](../sync/mutex.md)
- [Drop とリソース解放](../../ownership/drop.md)
- [ライフタイムとリージョン](../../ownership/lifetimes.md)
- [tzroutine](../../concurrency/tzroutine.md)
- [型クラスと制約](../../types/type-classes.md)
