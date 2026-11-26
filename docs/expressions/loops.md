# ループと反復

Tsuzuri は、コレクションや整数範囲を走査する `for ... in`、両端を含む整数カウンタループ `for ... = ... to / downto`、および条件が成り立つ間繰り返す `while ... do` の 3 種類の反復構文を備えています。すべてのループ式は評価結果として `unit`（`()`）を返し、`break` と `continue` による制御およびアフィン所有権の安全性検査が統一的に適用されます。

## 要点

- 3 種類のループ構文すべての本体と式全体の評価型は `unit`（`()`）です。集計結果を作る場合はループの外側で `let mut` 変数を宣言して更新します。
- `for pat in source do` は配列・スライス・リスト・`Vec`・文字列・整数範囲・`Seq`・受信チャネルを直接走査し、配列やリストは複製せず共有借用します。
- Edition 2028 の整数範囲は、半開区間 `a ..< b`、閉区間 `a ..= b` および `a .. b`、左開区間 `a <.. b`、開区間 `a <..< b`、ならびに刻み指定 `a .. step ..= b` などをサポートします。
- 末尾相対位置 `^k`（`^0` が末尾要素）は添字・スライス専用であり、配列の末尾基準で反復する場合はスライス借用 `for x in ref xs[1 ..< ^0] do` または `xs.length - k` を用います。
- `for i = a to b do` / `downto` は任意の整数型に対応し、型の最大値・最小値（符号なし型の `0` を含む）が終点であってもオーバーフローによる無限ループを起こさず安全に停止します。
- ループの外側で宣言した非 Copy 変数をループ本体内でムーブしたまま次の反復へ進むコードは `E1012` で拒否されます（反復末尾までの再代入、または直後の `break` で回復します）。

## 3 つのループ構文の比較

| 構文 | 主な対象・用途 | ループ変数の束縛 | 刻み幅 |
| --- | --- | --- | --- |
| `for pat in source do` | コレクション要素の走査、刻み付きや半開区間の整数範囲、`Seq`、チャネル受信 | 反駁不可能なパターン `pat`（不変） | 範囲では任意の整数刻み（既定 `1`） |
| `for i = a to b do`<br/>`for i = a downto b do` | 両端を含む単純な昇順・降順の整数カウンタ | 単一の識別子 `i`（不変） | `+1`（`to`）または `-1`（`downto`）固定 |
| `while cond do` | 反復回数が事前に定まらない状態駆動ループ | なし（外側の `let mut` を更新） | 任意 |

---

## コレクションの反復（for ... in）

```text
for パターン in コレクション式 do
    本体
```

`コレクション式` はループ開始時に 1 回だけ評価されます。各反復で要素が反駁不可能なパターン（識別子、タプル `(a, b)`、レコードなど）に束縛され、本体が実行されます（`Some x` のような反駁可能パターンは Edition 2027 以降では `E1021` で拒否されます）。

```tsuzuri run=14
let pairs = [(1, 2), (3, 4)]
let mut weighted = 0

for (left, right) in pairs do
    weighted = weighted + left * right

weighted
```

### 直接反復できる型と Module.iter を使う型

`for ... in` が直接受け付ける型と、列挙される要素の型・所有権の扱いは次のとおりです。

| 走査対象 | 要素の型 | 所有権・借用の挙動 |
| --- | --- | --- |
| 配列 `[T]`、配列スライス `ref [T]` | `T`（非 Copy は読み取りビュー） | コレクション全体を共有借用（ディープコピーなし） |
| 連結リスト `[\|T\|]` | `T`（非 Copy は読み取りビュー） | 先頭チャンクから共有借用 |
| `Vec<T>` | `T`（非 Copy は読み取りビュー） | インデックス昇順に共有借用 |
| `string` | `i16u`（UTF-16 コード単位） | 文字列を共有借用（`.length` と同じ 16 ビット単位。サロゲートペアは 2 回） |
| `utf8string` | `ubyte`（UTF-8 バイト） | バイト列を共有借用（8 ビット単位） |
| 整数範囲（`0 ..< n` 等） | 境界と同じ整数型 | 値を 1 つずつ生成 |
| `Seq<'a>` | `'a` | **ワンショット消費**（`Seq` 自体がムーブされ再利用不可 `E1012`） |
| `Channel<T>`、`ReceiveOnly<T>`（および `ref`） | `T`（受信した所有値） | チャネルが閉じて空になるまで `Channel.recv` で待機・受信 |

- **連想コレクションと利用者定義型**: `Map`・`Set`・`HashMap`・`HashSet` や利用者定義型を直接 `for ... in` に渡すと `E1005` になります。`Map.iter (ref m)` のように明示的に `Seq` へ変換してから走査します。
- **固定長配列 `[T; N]`**: 直接は反復できないため（`E1005`）、`for i in 0 ..< N do` のように添字範囲で走査します。
- **走査中の保護と要素借用**: 配列・リスト・`Vec`・文字列の走査中は元のコレクションが共有借用されるため、ループ内で元のコレクションへ代入・ムーブ・排他借用を行うと `E1014` になります。また `for unit in text do` で得られる `string` のコード単位 `unit` は反復ごとの一時値であるため、`ref unit` を反復の外へ持ち出すことはできません（`E1013`）。配列要素への `ref` は配列自体の生存期間に従います。

```tsuzuri run=42
let scores = Map.singleton "answer" 42
let mut found = 0

for (key, value) in Map.iter (ref scores) do
    if deref key == "answer" then
        found = deref value

found
```

---

## 整数範囲の反復（Edition 2028 の範囲構文）

`for i in ... do` では、`i8`〜`i128` および `i8u`〜`i128u` のすべての整数型について、端点の開閉を明示した範囲構文とステップ幅指定を使用できます。

| 範囲構文 | 区間の意味 | 刻み指定の可否 | エディション対応 |
| --- | --- | --- | --- |
| `a ..< b` | 半開区間 $[a, b)$（始端を含み終端を含まない） | `a .. step ..< b` | 全エディション共通（添字走査 `0 ..< xs.length` に推奨） |
| `a ..= b` | 閉区間 $[a, b]$（始端・終端ともに含む） | `a .. step ..= b` | 全エディション共通 |
| `a .. b` | 閉区間 $[a, b]$（始端・終端ともに含む） | `a .. step .. b` | **Edition 2028 で正準形**（Edition 2027 では `E0004`、2026 では `W1007`） |
| `a <.. b` | 左開右閉区間 $(a, b]$（`a + 1` から `b` まで） | 不可（`E0002`） | Edition 2028 以降 |
| `a <..< b` | 開区間 $(a, b)$（`a + 1` から `b - 1` まで） | 不可（`E0002`） | Edition 2028 以降 |

```tsuzuri run=idx%3D123%20step%3D28%20open%3D5
let words = ["a", "bb", "ccc"]
let mut idx = 0
for i in 0 ..< words.length do
    idx = idx * 10 + words[i].length

let mut step_sum = 0
for n in 10 .. -2 ..= 4 do
    step_sum = step_sum + n

let mut open_sum = 0
for k in 1 <..< 4 do
    open_sum = open_sum + k

$"idx={idx} step={step_sum} open={open_sum}"
```

### 範囲評価・境界安全性・スライスとの連携

- **評価順序とゼロ刻みトラップ**: 始点・刻み・終点は同じ整数型でなければならず、ループ開始前に左から右へ 1 回ずつ評価されます。刻みを省略すると `1` になり、負の刻みを指定すると降順になります。刻みが `0` の場合は範囲が空であっても実行時に `range step is zero` でトラップします。
- **型の端における安全性**: 次の値がその整数型の表現範囲を超える場合はオーバーフローして無限ループになることなくその場で反復を終了します。また `127i8 <.. 127i8` や `255i8u <.. 255i8u` のように始点が型の最大値である左開区間も、`start + 1` を折り返さずに 0 回の反復として安全に終了します。
- **境界検査の除去と `@no_trap`**: `for i in 0 ..< xs.length do`（および `0 ..= xs.length - 1`）の内部での `xs[i]` アクセスは、コンパイラによって境界内であることが証明され、境界検査の省略および `@no_trap` の通過対象になります。
- **値としての保存不可**: 整数範囲は `for ... in` 専用の構文であり、`let r = 0 ..< 10` のように変数へ束縛すると `E1005` になります。
- **旧 `a .. b` との関係**: Edition 2028 では、`for i in a .. b` と配列スライス `ref xs[a..b]` の双方が「終端を含む閉区間」として統一されました（Edition 2026/2027 のスライス `ref xs[a..b]` は半開区間であったため、`tsuzuri fix --edition 2028` は既存の `2026` / `2027` コードのスライスを `ref xs[a..<b]` へ自動変換しつつ、`for` の `a .. b` はそのまま保持します）。
- **末尾相対境界 `^k` との組み合わせ**: `^0`（末尾要素）や `^1`（末尾の 1 つ手前）は対象コレクションの長さに対する相対指定であるため、ブラケット `[...]` の外にある整数範囲 `for i in 0 ..< ^1 do` には直接書けません（`E0002` `from_end_outside_index`）。末尾を基準に一部区間を走査したい場合は、スライス借用 `ref xs[1 ..< ^0]` を `for ... in` に渡すか、`xs.length - 1` を使用します。

```tsuzuri run=90
let xs = [10, 20, 30, 40, 50]
let mut middle_sum = 0

for v in ref xs[1 ..< ^0] do
    middle_sum = middle_sum + v

middle_sum
```

---

## カウンタループ（for ... to / downto）

両端を含む刻み幅 `1` の昇順ループは `for 識別子 = start to finish do`、刻み幅 `-1` の降順ループは `for 識別子 = start downto finish do` でも記述できます。

```tsuzuri run=55%203210
let mut asc: i64 = 0
for i = 1 to 10 do
    asc = asc + i as i64

let mut desc: i64 = 0
for b = 3i8u downto 0i8u do
    desc = desc * 10 + b as i64

$"{asc} {desc}"
```

- ループ変数は不変の単一識別子であり（パターン分解は不可、本体での再代入は `E1014`）、型は `start` と `finish` から推論されます（`i8`〜`i128`・`i8u`〜`i128u` すべてに対応し、文脈がなければ `i32`）。
- 走査方向に対してすでに空の範囲（`10 to 1` や `1 downto 10`）では本体は 1 度も実行されません。
- `2147483647i32` までの `to` や `0i8u` までの `downto` など、型の限界値を終点に指定してもカウンタ折り返しを起こさず最終反復の直後に停止します。

---

## 条件反復ループ（while ... do）

事前に反復回数が定まらない処理には `while 条件式 do 本体` を使用します。

```tsuzuri run=16
let mut value = 1

while value < 10 do
    value = value * 2

value
```

- 条件式は厳密に `bool` 型でなければならず（`E1003`）、各反復の開始前に毎回評価されます。初回から `false` であれば本体は 1 度も実行されません。
- `while true do` と `break` を組み合わせて本体途中に脱出条件を持つループを書けます。なお、静的効果検査 `@terminates` において `while` ループは停止保証の対象外（`diverge`）と判定されます。

---

## break と continue

3 種類のループすべてにおいて、`break` と `continue` を使用できます。両者とも評価型は `unit` です。

```tsuzuri run=12
let mut sum = 0

for n in 1 ..= 10 do
    if n % 2 == 1 then
        continue
    if n > 6 then
        break
    sum = sum + n

sum
```

- **`break`**: 最も内側のループを即座に終了します。その反復内で作成されたローカル所有値は逆順（LIFO）に解放されます。
- **`continue`**: 現在の反復の残りを破棄（ローカル所有値を解放）し、次の反復のステップ更新・条件判定へ進みます。`while` ループで `continue` を使う際は、カウンタ更新がスキップされて無限ループにならないよう配置順に注意してください。
- **越えられない境界（`E1023`）**: 値付き `break` や外側のループを指定するラベル付き脱出はありません。また、ラムダ式、`tzroutine { ... }`、コンピュテーション式、および `finally` 節を持つ `try` 式の内側からは外側のループへ `break` / `continue` できません（`E1023`。`finally` を持たない `try ... with` からは脱出可能です）。

---

## ループ内の所有権管理（E1012 と再代入による回復）

ループ本体は複数回実行されうるため、ループの外側で宣言された非 Copy 変数（`string` や `Vec` など）を本体内でそのまま消費（ムーブ）して次の反復へ進むと、2 回目の反復でムーブ済みの値を読むことになるためコンパイルエラー **`E1012`**（`note: value moved here, in the previous iteration of the loop`）になります。

```text
def consume :: own string -> i64 = \s -> s.length

let token = "once"
for _ in 0 ..< 3 do
    let _ = consume token
// error[E1012]: use of moved or partially moved value 'token'
```

ループ内で外側の非 Copy 変数をムーブしたい場合は、次のいずれかの方法で所有権の整合性を保ちます。

1. **参照で渡す**: 値を消費する必要がなければ、共有借用（`ref token` または共有借用引数の関数）で読み取ります。
2. **`let mut` と再代入で回復する**: 変数を `let mut` で宣言し、次の反復が始まる前（`continue` 経路を含むすべての継続経路）に新しい所有値を再代入します。
3. **ムーブ直後に `break` で脱出する**: 消費した反復で必ず `break` してループを終える場合、次の反復は実行されないため再代入なしでコンパイルを通過します。

```tsuzuri run=step-3%3A16
def consume_and_count :: own string -> i64 = \s -> s.length

let mut state = "init"
let mut total_chars = 0

for step in 1 ..= 3 do
    total_chars = total_chars + consume_and_count state
    state = $"step-{step}"

$"{state}:{total_chars}"
```

## 関連項目

- [条件分岐](./conditionals.md)
- [演算子と式](./operators.md)
- [束縛と値](./bindings-and-values.md)
- [パターンマッチング](./pattern-matching.md)
- [契約と属性](./contracts-and-attributes.md)
- [所有権とムーブ](../ownership/ownership-and-move.md)
- [借用と参照](../ownership/borrowing.md)
- [Seq](../stdlib/collections/seq.md)
- [Channel](../stdlib/sync/channel.md)
- [Slice](../stdlib/numeric/slice.md)
