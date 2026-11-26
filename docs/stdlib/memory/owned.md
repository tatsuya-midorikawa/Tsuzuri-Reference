# Owned

`Owned` モジュールは、`Drop` を持つリソースや非 `Copy` 値を所有したまま持ち運べる所有クロージャ `Owned.Function<'a, 'b>` と、所有値をスコープ終端より前に即座に解放する `Owned.drop` を提供します。

Tsuzuri の通常の関数値（`'a -> 'b`）は `Copy` 型クラスを満たし、代入時にクロージャ環境を複製するため、二重解放を招く `Drop` 型や同期ハンドルの捕捉が禁止されています（`E1005`）。`Owned.Function` は自身が非 `Copy` の単一所有値となることで、リソースの所有権をクロージャ内に安全に保持し、破棄時にちょうど 1 回だけ解放します。`Routine.go`・`WaitGroup.go`・`ErrGroup.go`・`Context.after_func`・`Time.after_func` など、別タスクへ処理を引き渡す標準 API の基盤としても使われます。

## 要点

- `Owned.Function<'a, 'b>` は非 `Copy` の不透明な所有関数型であり、`Owned.function` で構築し、`Owned.call` で共有借用から何度でも呼び出せる。
- `Owned.function` が捕捉できるのは参照を含まない所有値のみである。借用（`ref T`）や借用を保持する関数値を捕捉しようとすると `E1013` で拒否される。
- クロージャ本体は捕捉した値を借用として参照する。2 回目以降の呼び出しで二重ムーブが起きないよう、本体から捕捉値をムーブで取り出すことはできない（`E1012`）。
- `Owned.drop` は任意の所有値をその場でムーブ消費し、デストラクタを直ちに実行する。

## 通常の関数値との違い

通常のラムダ式 `\x -> ...` は何度でも値をコピーできる再利用可能な関数値です。もしファイルハンドルや `Channel`・`Arc` 以外の独自 `Drop` リソースを通常のラムダ式に捕捉できてしまうと、関数値のコピーによって同一ハンドルのデストラクタが複数回実行されてしまいます。

| 特性 | 通常の関数値 `'a -> 'b` | `Owned.Function<'a, 'b>` |
| --- | --- | --- |
| `Copy` インスタンス | あり（代入時に環境をディープコピー） | なし（代入・引数渡しはムーブ、`E1012`） |
| `Drop` 型・非 `Capture` 型の捕捉 | 不可（`E1005`） | 可能（`Rc`・非 `Sync` な `Arc` を除く所有値） |
| 外側の参照（`ref T`）の捕捉 | スコープ内で可能 | 不可（所有値のみ、`E1013`） |
| 呼び出し構文 | `f x` | `Owned.call (ref f) x` |
| 捕捉値の解放 | コピーごとに独立 | `Owned.Function` の破棄時に 1 回のみ実行 |

## `Owned.function` と `Owned.call` の基本

`Owned.function` に 1 引数のラムダ式（または借用を持たない関数）を直接渡して `Owned.Function<'a, 'b>` を生成し、`Owned.call (ref f) arg` で呼び出します。`Owned.call` は第1引数を共有借用で受け取るため、所有クロージャを消費せずに複数回呼び出せます。

```tsuzuri run=first%3D41%20second%3D45
record Ticket { base: i64 }

instance Drop<Ticket> {
    fn drop _t = ()
}

let ticket = Ticket { base: 40 }
let calc = Owned.function (\offset -> ticket.base + offset)
let first = Owned.call (ref calc) 1
let second = Owned.call (ref calc) 5
$"first={first} second={second}"
```

### 呼び出し結果の借用規則

`Owned.call` を 2 つの引数に直接適用した `Owned.call (ref f) x`（およびパイプライン `x |> Owned.call (ref f)`）では、戻り値が保持しうる借用は引数 `x` に由来するものだけです。`Owned.Function` 自身は外部の借用を持たず、かつ本体から捕捉値への参照を返すことも `E1013` で禁止されているため、戻り値は `f` を借用しません。したがって、戻り値を受け取った直後に `f` を破棄できます。

```tsuzuri run=24
let label = String.repeat 3 (ref "abcdefgh")
let make_thunk = Owned.function (\() -> {
    let len = String.length (ref label);
    \() -> len
})
let thunk = Owned.call (ref make_thunk) ()
Owned.drop make_thunk
thunk ()
```

一方、`let caller = Owned.call` のように関数値化した経由での呼び出しや、`Owned.call (ref f)` の部分適用では、`f` への借用が結果に残るため結果を使い終わるまで `f` をムーブできません（`E1014`）。また、カリー化関数を包んで `Owned.call` の戻り値型 `'b` 自体が関数型となる場合は、第2引数 `'a` を環境に束縛した通常の関数値が作られるため、`'a` に `Capture` 制約が課されます。

## `Owned.drop` による明示的な早期解放

ロックガードや共有ハンドル、ファイルなどをスコープの終わりより前に手放したい場合は、`Owned.drop` に値を渡して即座に破棄します。

```tsuzuri run=closing%203%0Aafter%20drop
record Guard { id: i64 }

instance Drop<Guard> {
    fn drop g = do! IO.writeln $"closing {g.id}"
}

def main :: unit -> i32 = \() ->
    let g = Guard { id: 3 }
    Owned.drop g
    do! IO.writeln "after drop"
    0
```

`Owned.drop` に渡した変数はムーブ済みとなり、その後の参照は `E1012` として静的に検出されます。

## 呼び出し規則とコンパイル時検査

`Owned.Function` のメモリ安全性を保証するため、コンパイラは次の規則を検査します。

### 1. 直接適用と 1 引数ラムダ

`Owned.function` は `Owned.function (\x -> ...)` または `(\x -> ...) |> Owned.function` のように引数へ直接適用する必要があります。`let wrap = Owned.function` のように関数値として取り出すことはできません（`E1013`）。また、ラムダ式のパラメータは 1 つに限られ、複数パラメータ `\x y -> ...` を渡すと `E1006` になります。複数値を渡す場合はタプル `(x, y)` を受け取ります。

### 2. 本体からの捕捉値ムーブ禁止

`Owned.call` は同じクロージャに対して複数回実行できるため、ラムダ本体の中で捕捉値をムーブしたり `Owned.drop` したりすることはできません（`E1012`）。捕捉値を一度だけ消費して終了したい並行処理には、`tzroutine { ... }` ブロックを直接使用します。

### 3. 所有値のみの捕捉（借用の排除）

`Owned.Function` は生成元のスタックフレームを超えて別 `tzroutine` やタイマーへ渡されるため、参照 `ref T` や、借用を捕捉した関数値を保持することはできません（`E1013`）。

```text
let data = "temporary"
let r = ref data
let bad = Owned.function (\n -> r.length + n)
// error[E1013]: an owned function captures only owned values; ref string contains a reference
```

同様に、関数の仮引数として受け取った通常の関数値 `work: unit -> unit` は呼び出し元の借用を保持している可能性があるため、関数内で `Owned.function work` に変換することはできません（`E1013`）。遅延・並行実行する処理を受け取る高階関数は、仮引数の型自体を `own Owned.Function<unit, unit>` として宣言します。

```tsuzuri run=dispatched%0Adone
def run_twice :: own Owned.Function<unit, string> -> string
fn run_twice job =
    let first = Owned.call (ref job) ()
    let _second = Owned.call (ref job) ()
    $"{first}\ndone"

let prefix = "dispatched"
run_twice (Owned.function (\() -> $"{ref prefix}"))
```

### 4. 不透明表現と再捕捉の禁止

`Owned.Function` の内部表現は不透明（opaque）であり、フィールド参照やレコード構築は `E1022` となります。また、`Owned.Function` 自体を通常の `Copy` クロージャ `\x -> Owned.call (ref f) x` に再捕捉することは `E1005` で拒否されます（別の `Owned.function` や `tzroutine { ... }` への捕捉は可能です）。

## 引数の順序

`Owned` モジュールはリソースハンドル（コンパイラ組み込みハンドル）の例外分類に属し、`Owned.call` は所有関数ハンドル `ref Owned.Function<'a, 'b>` を**第1引数**、入力値 `'a` を第2引数に取ります。`Owned.function` と `Owned.drop` は 1 引数関数です。詳細は [引数の順序](../conventions.md) を参照してください。

## API リファレンス

| 名前 | 種別 / 型シグネチャ | 説明 |
| --- | --- | --- |
| `Owned.Function<'a, 'b>` | 型（不透明レコード、非 `Copy`） | 所有値を捕捉できる 1 引数関数型。破棄時に捕捉値を 1 回解放する |
| `Owned.function` | `('a -> 'b) -> Owned.Function<'a, 'b>` | 借用を持たない 1 引数ラムダまたは関数から所有クロージャを生成する（直接適用必須） |
| `Owned.call` | `ref Owned.Function<'a, 'b> -> 'a -> 'b` | 共有借用を通じて所有クロージャを呼び出す |
| `Owned.drop` | `'a -> unit` | 任意の所有値をその場で消費し、デストラクタを即時実行する |

## 関連項目

- [Routine](../sync/routine.md)
- [WaitGroup](../sync/waitgroup.md)
- [ErrGroup](../sync/errgroup.md)
- [Context](../sync/context.md)
- [ラムダ式](../../expressions/lambdas.md)
- [所有権とムーブ](../../ownership/ownership-and-move.md)
- [Drop とリソース解放](../../ownership/drop.md)
- [リソース管理とアサーション](../../expressions/resources-and-assertions.md)
