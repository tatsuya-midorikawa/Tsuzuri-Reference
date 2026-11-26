# 条件分岐

Tsuzuri の `if` は文ではなく**値を返す式**です。条件に応じて異なる値を計算してそのまま変数に束縛したり関数の戻り値にしたりでき、すべての分岐の型一致と所有権の整合性がコンパイル時に静的に検証されます。

## 要点

- 基本構文は `if 条件 then 式1 else 式2`（または波括弧を用いた `if 条件 { 式1 } else { 式2 }`）であり、選択された分岐の評価値を返します。
- 多方向分岐には `elif` または `else if` を使います（両者は完全に同じ意味です）。
- 条件式は厳密に `bool` 型でなければならず、数値 `0` や空文字列からの暗黙の真偽値変換はありません（`E1003`）。
- すべての分岐の結果型は一致している必要があります（`E1003`）。`else` を省略できるのは `then` 側の型が `unit`（`()`）のときだけです。
- 非 Copy 変数を片方の分岐だけでムーブした場合、合流地点以降ではその変数はムーブ済みとみなされ、再代入しない限り使用できません（`E1012`）。

## 式としての if ... then ... else

条件式を最初に評価し、`true` であれば `then` 分岐のみを、`false` であれば `else` 分岐のみを実行時に評価します。選ばれなかった分岐は実行されませんが、コンパイル時にはすべての分岐が型検査と所有権検査を受けます。

```tsuzuri run=Pass%3A42
let score = 78
let status = if score >= 60 then "Pass" else "Fail"
let code = if status == "Pass" then 42 else 0

$"{status}:{code}"
```

分岐の本体に複数の文や束縛を並べる場合は、`then` / `else` の次行を深くインデントするインデントブロック、または波括弧 `{ ... }` による明示ブロックを使用します。波括弧ブロックを使う場合は `then` を省略して `if cond { ... } else { ... }` と書くこともできます。

```tsuzuri run=150
let urgent = true
let fee =
    if urgent then
        let base = 100
        let surcharge = 50
        base + surcharge
    else
        100

fee
```

> [!NOTE]
> `if` の条件式の位置にレコード構築リテラルを直接置くと、波括弧 `{ ... }` が `if` 本体のブロック開始と解釈されて構文エラー `E0002` になります。条件内でレコードリテラルを使う場合は `if (Config { enabled: true }).enabled then ...` のように丸括弧で囲みます。

## 多方向分岐（elif・else if）とネスト

複数の条件を上から順に判定する場合は、インデント構文では `if` と同じ列に `elif` を連ねます。波括弧ブロック構文や 1 行の式では `else if` も同じように記述できます（複数行のインデント構文で `else if` と書くと、`if` の開始列が `else` の右へずれるため後続の `else` と列が揃わなくなります。複数行のキーワード形式では `elif` を使用してください）。最初に `true` となった節の式だけが評価され、すべて `false` の場合は末尾の `else` 節が評価されます。

```tsuzuri run=10
def discount_rate :: i64 -> i64 = \amount ->
    if amount >= 10000 then 20
    elif amount >= 5000 then 10
    elif amount >= 2000 then 5
    else 0

discount_rate 6400
```

波括弧ブロックを用いた `else if` の例は次のとおりです。

```tsuzuri run=5
def shipping_tier :: i64 -> i64 = \weight ->
    if weight >= 1000 {
        20
    } else if weight >= 500 {
        10
    } else {
        5
    }

shipping_tier 300
```

共用体のケース分解や複数の値・構造の組み合わせによって分岐したい場合は、`if` を深くネストするよりも網羅性検査を備えた [`match` 式](./pattern-matching.md)を使う方が安全で明快です。

## else の省略と unit 型

ローカル変数の更新や標準出力への書き込みなど、副作用のみを目的とする分岐では `else` 節を省略できます。

```tsuzuri run=42
let mut total = 40
let add_bonus = true

if add_bonus then
    total = total + 2

total
```

`else` 節を省略した `if cond then expr` は、内部的には `if cond then expr else ()` と同じ意味を持ちます。したがって、`then` 側の式 `expr` も必ず `unit` 型を返さなければなりません。`if flag then 42` のように非 `unit` の式で `else` を省くと、`i32` と `unit` の型不一致エラー `E1003` になります。

## 条件式と分岐結果の型一致規則

### 条件式は bool 型のみ

条件式の型は `bool` のみを受け付けます。C や Python のように整数 `0` や空コレクションを偽とみなす暗黙変換は存在せず、`bool` 以外の型を渡すと `E1003` になります。必ず `count != 0` や `text.length > 0` のように比較式で明示します。

### 分岐間の型一致と匿名共用体への注入

`then`・`elif`・`else` のすべての分岐は、同一の型を返す必要があります。片方が `string`、もう片方が `i64` のような分岐は `E1003` で拒否されます。

状況によって異なる型の値を返したい場合は、[共用体（union）](../types/unions.md)、[`Maybe`](../stdlib/core/maybe.md) / [`Result`](../stdlib/core/result.md)、または期待型に[匿名共用体](../types/anonymous-unions.md)を指定した注入を用います。

```tsuzuri run=num%3A42
let flag = true
let value: (i64 | string) = if flag then 42 else "fallback"

match value with
| :? i64 as n -> $"num:{n}"
| :? string as s -> s
```

上の例では、変数 `value` に匿名共用体 `(i64 | string)` の型注釈が与えられているため、`then` 分岐の `42` と `else` 分岐の `"fallback"` がそれぞれ同じ匿名共用体型の値へ自動的に包まれます。

## 両分岐における所有権の合流規則

Tsuzuri の所有権チェッカーは、`if` 式の全分岐が終了して合流する地点において、外側の変数の所有権状態と借用状態を静的に統合します。

### 1. 片方の分岐でのムーブと再代入による回復

非 Copy 型の変数（`string` や `Vec` など）を `then` と `else` の**一方の分岐だけでもムーブ**すると、合流地点では「すでに消費された可能性がある値」として扱われます。そのため、合流後にその変数を使用すると `E1012`（`use of moved or partially moved value`）になります。

```text
let label = "ready"
if flag then
    let consumed = label
    ()
else
    ()
// コンパイルエラー E1012: 片方の分岐でムーブされたため合流後は使用不可
label.length
```

値を手放さずに分岐内で参照したい場合は、ムーブではなく共有借用（`ref label` や共有借用引数の関数呼び出し）を使います。また、`let mut` で宣言した可変変数であれば、ムーブした分岐の中で新しい値を再代入しておくことで、両分岐とも有効な値を保持した状態で合流でき、後続のコードで引き続き使用できます。

```tsuzuri run=updated%3A7
def consume :: own string -> i64 = \s -> s.length

let mut label = "initial"
let flag = true

if flag then
    let n = consume label
    label = $"updated:{n}"

label
```

### 2. 分岐をまたぐ借用の追跡と最終使用ムーブ最適化

`if` 式の結果として参照を返す場合（例: `let chosen = if cond then ref left else ref right`）、コンパイラは `chosen` が `left` と `right` の**両方**を借用しうるものとして追跡します。`chosen` の最後の使用が終わるまでは、`left` と `right` のどちらに対してもムーブや排他変更は行えません（`E1014`）。

```tsuzuri run=5
let left = "alpha"
let right = "beta"
let pick_left = true

let chosen = if pick_left then ref left else ref right
chosen.length
```

また、Copy 要素の配列 `[i64]` などを各分岐の末尾で返し、それ以降その元の変数が一切読まれない場合は、コンパイラの最終使用解析によって不要なディープコピーが省略され、ムーブとして効率よく合流値へ引き渡されます。

## 関連項目

- [演算子と式](./operators.md)
- [ループと反復](./loops.md)
- [パターンマッチング](./pattern-matching.md)
- [型の概要と unit 型](../types/overview.md)
- [匿名共用体](../types/anonymous-unions.md)
- [所有権とムーブ](../ownership/ownership-and-move.md)
- [借用と参照](../ownership/borrowing.md)
