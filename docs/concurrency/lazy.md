# 遅延評価とメモ化（OnceValue・サンク・Seq）

Tsuzuri は正格評価（call-by-value）を採用しており、変数束縛や関数の実引数はその位置に到達した時点で即座に評価されます。F# の `lazy expr` キーワードや組み込みの `Lazy<'a>` / `Lazy.force` に相当する専用構文は言語コアには設けられておらず、**「単なる実行の遅延」「初回評価結果のメモ化（call-by-need）」「オンデマンド列生成」「副作用の遅延」**を目的ごとに明示的な型と標準ライブラリで使い分けます。

## 要点

- Tsuzuri には組み込みの `lazy` キーワードや `Lazy<'a>` 型は存在せず、用途に応じて `OnceValue<'a>`、サンク（`unit -> 'a`）、`Seq<'a>`、`IO<'a>` を選択する。
- 初回アクセス時に1度だけ計算して結果をメモ化する **call-by-need（必要時評価）** には標準ライブラリの [`OnceValue<'a>`](../stdlib/sync/once.md)（`OnceValue.create` / `OnceValue.get`）を使用する。
- メモ化を伴わない軽量な遅延評価には引数 `unit` を取る関数値 **`unit -> 'a`（サンク）** を使用する。
- 要素を必要な分だけ逐次生成する遅延ストリームには [`Seq<'a>`](../stdlib/collections/seq.md)、入出力の実行タイミング制御には [`IO<'a>`](../stdlib/sys/io.md) を使用する。

## 遅延評価・メモ化手段の使い分け

アフィン所有権と言語全体のデータ競合防止を両立するため、Tsuzuri では「メモ化キャッシュ（内部可変状態）を持つかどうか」が型に明確に現れます。

| 手法・型 | 評価タイミング | 結果のメモ化 | 並行安全性 | 主な用途 |
| --- | --- | --- | --- | --- |
| **`OnceValue<'a>`** | 最初の `OnceValue.get` 呼び出し時 | **あり**（最大1回だけ初期化し、以後は `ref 'a` をロックなしで返す） | スレッド安全（`Arc<OnceValue<'a>>` で複数 tzroutine 間共有可） | 設定の遅延ロード、重いルックアップ表の初回構築（F# の `Lazy<'T>` / Rust の `OnceLock<T>` 相当） |
| **サンク（`unit -> 'a`）** | `thunk ()` 呼び出し時 | **なし**（呼ぶたびに再計算） | 捕捉環境が `Send + Sync` なら共有可 | 短絡分岐や高階関数での軽量な遅延評価 |
| **`Once`** | 最初の `Once.do_` 呼び出し時 | 実行済み状態のみ記録（戻り値は `unit`） | スレッド安全 | 1回限りのグローバル・リソース初期化処理 |
| **`Seq<'a>`** | `for`・`Seq.next`・`Seq.to_array` で要素を要求した時 | **なし**（非 `Copy` の1回消費イテレータ） | 単一所有者で逐次消費 | 巨大データや無限列のオンデマンド生成 |
| **`IO<'a>`** | `main` や `let!` / `do!` で実行した時 | **なし**（実行ごとに作用が発生） | 値として組み立て可能 | ファイル・コンソール・通信などの副作用順序の明示 |

## `OnceValue<'a>` による必要時評価とメモ化

計算コストの高い値を「実際に必要になった最初の1回だけ計算し、2回目以降は計算済みの値をそのまま参照したい」という call-by-need パターンには、標準ライブラリの [`OnceValue<'a>`](../stdlib/sync/once.md) を使用します。

### 基本操作（生成・強制評価・結果の参照）

- `OnceValue.create ()` で未評価状態のセルを作成します。
- `OnceValue.get (ref cell) (\() -> expr)` が F# の `Lazy.force` に相当します。セルが未評価であれば初期化関数を実行して結果を格納し、その値への共有参照 `ref 'a` を返します。2回目以降の呼び出しでは渡した初期化関数は実行されず、メモ化された値への `ref 'a` が acquire ロードのみで高速に返されます。
- 複数の [`tzroutine`](tzroutine.md) が同時に初回の `OnceValue.get` を呼び出した場合も、初期化関数を実行するのは1つだけであり、他の呼び出し元はその完了を待機してから同じ計算結果を受け取ります。

```tsuzuri run=calls%3D1%20value%3D84
let counter = Atomic.create 0i64
let counter_ref = ref counter
let cache: OnceValue<i64> = OnceValue.create ()

let v1 = deref (OnceValue.get (ref cache) (\() ->
    let _prev = Atomic.fetch_add counter_ref 1
    42 * 2
))
let v2 = deref (OnceValue.get (ref cache) (\() ->
    let _prev = Atomic.fetch_add counter_ref 1
    999
))

$"calls={Atomic.load counter_ref} value={v2 + v1 - 84}"
```

1回目の `OnceValue.get` で `42 * 2` が計算・保存されるため、2回目の呼び出しでは初期化クロージャは呼ばれず（`counter` は `1` のまま）、メモ化された `84` が返されます。文字列や配列のような非 `Copy` 型の値も、複製せずに共有参照 `ref T` としてそのまま読み取れます。

### 評価済み状態の判定と値の取り出し

`OnceValue<'a>` の所有権を消費する `OnceValue.into_inner cell` を呼ぶと、すでに評価済みであれば `Maybe.Some value`、一度も評価されていなければ初期化関数を走らせることなく `Maybe.None` を返します。セルを消費せずに外部から評価済みかどうかを観測したい場合は、`Atomic<bool>` フラグを併用するか初期化済みフラグをペアで管理します。

```tsuzuri run=none%20then%20some%3A%20tsuzuri
let untouched: OnceValue<string> = OnceValue.create ()
let first_state = match OnceValue.into_inner untouched with
    | Maybe.Some s -> s
    | Maybe.None -> "none"

let evaluated: OnceValue<string> = OnceValue.create ()
let _ref = OnceValue.get (ref evaluated) (\() -> "tsuzuri")
let second_state = match OnceValue.into_inner evaluated with
    | Maybe.Some s -> s
    | Maybe.None -> "none"

$"{first_state} then some: {second_state}"
```

### 所有権・捕捉・ライフタイム制約

`OnceValue<'a>` を安全に扱うため、コンパイラは次の制約を静的に検査します。

1. **`Send<'a>` かつ `Sync<'a>` 境界**: メモ化された値 `'a` は複数スレッドから共有参照 `ref 'a` として読み取られ得るため、`OnceValue.get` は `(Send<'a>, Sync<'a>)` を要求します（`Rc` などは格納できません）。
2. **参照寿命の連動（`E1013`）**: `OnceValue.get` が返す `ref 'a` の生存期間はセル `OnceValue<'a>` の借用期間に紐付きます。セル自身が破棄されるスコープの外へ参照を持ち出すと `E1013` となります。
3. **初期化結果への借用混入禁止（`E1013`）**: 初期化関数が返す値はセル内に保持され続けるため、外側のローカル変数を借用したクロージャなどを返すことはできません（`E1013`）。関数値を格納する場合は初期化関数の内部で完結した値から構築します。
4. **クロージャや `tzroutine` での共有方法**: `OnceValue<'a>` 自体は非 `Copy` の不透明型であり、通常のクロージャに直接捕捉することはできません（`E1005`）。複数の `tzroutine` から共有する場合は `Arc.new (OnceValue.create ())` で包み、`Arc.share` で配布してから `OnceValue.get (Arc.get (ref shared)) (\() -> ...)` と呼び出します。

```tsuzuri run=600
let shared_table = Arc.new (OnceValue.create ())
let wg = WaitGroup.create ()
let sum = Arc.new (Atomic.create 0i64)

for i in 0 ..< 3 do
    WaitGroup.add (ref wg) 1
    let done = WaitGroup.share (ref wg)
    let table = Arc.share (ref shared_table)
    let acc = Arc.share (ref sum)
    tzroutine {
        let data = OnceValue.get (Arc.get (ref table)) (\() -> [100, 200, 300])
        let _old = Atomic.fetch_add (Arc.get (ref acc)) data[i]
        WaitGroup.done (ref done)
    }

WaitGroup.wait (ref wg)
Atomic.load (Arc.get (ref sum))
```

## サンク（`unit -> 'a`）による軽量な遅延評価

メモ化やスレッド間同期が不要で、単に「条件が成立したときだけ計算を実行したい」「高階関数に未評価の式を渡したい」という場面では、`unit` を受け取るラムダ式 `\() -> expr`（型 `unit -> 'a`）が最も軽量です。

```tsuzuri run=fallback%3A%2010
def or_else_compute :: (unit -> i64) -> Maybe<i64> -> i64 = \fallback opt ->
    match opt with
    | Maybe.Some v -> v
    | Maybe.None -> fallback ()

let a = or_else_compute (\() -> 100 * 100) (Maybe.Some 5)
let b = or_else_compute (\() -> 10) Maybe.None
$"fallback: {b + a - 5}"
```

- **捕捉の規則**: 通常の関数値 `unit -> 'a` は `Copy` であるため、`Copy` 型の値や共有参照 `ref T` を自由に捕捉できます。一方で `string` や `Vec` などの非 `Copy` 所有値をムーブして捕捉したい場合は [`Owned.function`](../stdlib/memory/owned.md)（型 `Owned.Function<unit, 'a>`、`Owned.call` で呼び出し）を使用します。
- **既に計算できる値のキャッシュ**: 複数回参照する値が最初から必要だと分かっている場合は、遅延構造を使わず通常の `let result = compute ()` に束縛するのが最も単純かつ高速です。

## `Seq<'a>` と `IO<'a>` によるストリーム・作用の遅延

単一のスカラー値ではなく「要素列を要求された分だけ順番に計算したい」場合には [`Seq<'a>`](../stdlib/collections/seq.md) を使用します。

```tsuzuri run=14
let squares = Seq.unfold (\n -> Maybe.Some (n * n, n + 1)) 1
let mut sum = 0i64
let mut count = 0i64
for sq in squares do
    sum = sum + sq
    count = count + 1
    if count == 3 then break else ()
sum
```

`Seq.unfold` は無限列であっても定義時点では先頭要素すら計算せず、`for` ループで引き出された3要素分（$1^2 + 2^2 + 3^2 = 14$）だけを評価して `break` で停止します。`Seq<'a>` は内部状態を進める非 `Copy` のアフィン値であるため、同じ `Seq` を2回走査しようとすると `E1012` となり、イテレータの二重消費バグがコンパイル時に防がれます。再利用したい場合は `Seq.to_array`（有限列のみ）で配列に確定させるか、`Seq` を返す関数 `unit -> Seq<'a>` として定義します。

また、ファイル書き込みや標準出力などの副作用を「値として組み立ててから実行したい」場合には [`IO<'a>`](../stdlib/sys/io.md) アクションを使用します。`IO.writeln "done"` は構築した時点では出力を行わず、`do!` / `let!` または `Main.tz` のトップレベルで実行された時点で作用を起こします。

## 関連項目

- [tzroutine（軽量並行実行単位）](tzroutine.md)
- [select 式によるチャネル多重待機](select.md)
- [ラムダ式](../expressions/lambdas.md)
- [所有権とムーブ](../ownership/ownership-and-move.md)
- [Once と OnceValue](../stdlib/sync/once.md)
- [Owned](../stdlib/memory/owned.md)
- [Seq](../stdlib/collections/seq.md)
- [IO](../stdlib/sys/io.md)
