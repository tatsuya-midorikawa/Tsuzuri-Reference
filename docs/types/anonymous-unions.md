# 匿名共用体

匿名共用体は、`union` 宣言を行わずに `(i64 | string)` のように要素型そのものをケースとして並べる構造的な直和型です（F# の FS-1092 Anonymous Type-tagged Unions に相当）。期待型が匿名共用体に確定している位置では要素型の値をコンストラクタなしでそのまま記述でき、部分集合となる匿名共用体からの自動拡大（widening）にも対応します。値の取り出しには静的な型テストパターン `:? T` や部分絞り込み `:? (A | B)` を用い、`match` 式が全要素の網羅性をコンパイル時に検査します。

## 要点

- **平坦化・順序非依存の正規化**: `(string | i64)` と `(i64 | string)` は同一の型であり、入れ子 `(i64 | (string | bool))` は `(i64 | bool | string)` へ平坦化されます（要素数は 2〜32 個）。
- **重複・識別不能要素の静的検出**: 同一型の重複 `(Meters | f64)` や型変数単体 `('a | i64)`、型引数次第で一致し得る `(Maybe<'a> | Maybe<i64>)` は `E1041` として静的に拒否されます。
- **期待型での自動注入と拡大**: 期待型がある位置では要素型の値が自動的に包まれ（注入）、より要素の少ない匿名共用体 `(i64 | string)` は広い `(f64 | i64 | string)` へゼロ確保で拡大されます。
- **`:? T` と `:? (A | B)` による網羅的分解**: `match` 式で型テストと部分共用体への絞り込みを行えます（Edition 2027 以降では `let` や `for ... in` は反駁不可能パターンのみを受け付けるため、`match` で分解します）。
- **組み込み型クラスと JSON・CBOR 対応**: 要素型が満たせば `Eq`・`Ord`・`Hash`・`Display`・`Encode` が自動成立し、JSON / CBOR の値種別が重ならない組み合わせではタグなしの `Decode` も自動成立します。

## 型の構文と正規化

### 記述構文と結合優先順位

匿名共用体型は、必ず丸括弧 `(...)` の内部で 2 個以上 32 個以下の型を単一の縦線 `|` で区切って記述します（33 個以上は `E1017`、丸括弧の省略や `||` の誤記は `E0002`）。

```text
(i64 | string)                  // i64 または string
(string | i64)                  // 上と完全に同一の型
(i64 | (string | bool))         // 平坦化により (i64 | bool | string) と同一
((i64 -> i64) | string)         // 関数型要素（-> と * は | より強く結合）
Maybe<(i64 | string)>           // ジェネリック型引数内の匿名共用体
```

パターン内で型注釈として匿名共用体を書く場合は、OR パターンと区別するため `(x: (i64 | string))` のように内側の型も丸括弧で囲みます。

### 平坦化・正準順序・要素制約

コンパイラはすべての匿名共用体を以下の規則で正規化します。

1. **平坦化（Flattening）**: 要素の位置に別の匿名共用体（型エイリアス経由を含む）が現れた場合、その全要素を同じ階層へ展開します。
2. **順序非依存性と正準順序（Canonical Order）**: 書かれた順序は型の同一性に影響しません。コンパイラ内部および診断表示・`Ord` 比較・`Hash` 計算では、以下の決定論的な**正準順序**に整列されます。
   - 整数（ビット幅昇順、同幅では符号なし `i8u` が符号付き `i8` より先） → 2進浮動小数点 → 10進浮動小数点 → SIMD 型 → `bool` → `unit` → `char` → `utf8char` → `string` → `utf8string` → `record`（完全修飾名順） → `union`（完全修飾名順） → `[T]` → `[T; N]` → `[|T|]` → `Vec<T>` → タプル → 関数型 → `dyn` 型 → `Rc` / `Arc`
3. **重複・識別不能・借用要素の検査**: 曖昧な注入を防ぐため、以下の要素構成はコンパイルエラーになります（重複要素は黙って除去せず誤りとして通知します）。

| 記述例 | エラーコード | 理由 |
| --- | --- | --- |
| `(i64 \| i64)`、`type M = f64` での `(M \| f64)`、`((i64 \| string) \| i64)` | `E1041` | 同一の型が複数回出現している（`anonymous_union_duplicate_member`） |
| `('a \| i64)`、`('f<'a> \| i64)` | `E1041` | 先頭が型変数であり具体化後に他要素と衝突し得る（`anonymous_union_type_variable`） |
| `(Maybe<'a> \| Maybe<i64>)`、`((i64 -> 'r) \| (i64 -> i64 -> i64))` | `E1041` | 型引数によって同一型になり区別できない（`anonymous_union_indistinct_members`） |
| `((i64 -> i64) \| pure (i64 -> i64))` | `E1041` | 純粋関数値は非純粋関数型にも適合するため純粋性だけでは要素を選べない |
| `(ref string \| i64)`、`(Maybe<ref string> \| i64)` | `E1013` | 要素の型表記に直接借用が含まれている（`anonymous_union_borrowed_member`） |
| 展開後の要素数が 33 個以上 | `E1017` | 要素数上限（最大 32 個）の超過（`anonymous_union_member_limit`） |

なお、先頭の型構築子が異なる `(Maybe<'a> | i64)` や、具体型引数が異なる `(Maybe<i64> | Maybe<string>)`、および借用を内包する名前付きレコード `(View {r} | i64)` は有効な匿名共用体として宣言できます。

## 期待型による自動注入と部分共用体の拡大（Widening）

### 要素値の自動注入（Injection）

型注釈付き `let`、関数の引数・戻り値、パイプライン `|>`、レコードフィールド、注釈付き配列リテラル、`if` / `match` の分岐、比較演算子の右辺など、**期待型が匿名共用体 `U` に確定している位置**では、要素型の式がそのまま `U` の値としてタグ付けされます。

```tsuzuri run=12pt%2010px%20small
def format_size :: own (f64 | i64 | string) -> string = \size ->
    match size with
    | :? f64 as pt -> $"{pt}pt"
    | :? i64 as px -> $"{px}px"
    | :? string as keyword -> keyword

$"{format_size 12.0} {format_size 10} {format_size "small"}"
```

- **接尾辞なし数値リテラル**: 整数リテラルは `U` 内の整数要素（なければ `bigint`、それもなければ浮動小数点要素）を選び、小数リテラルは浮動小数点要素を選びます。`(i32 | i64 | string)` に `16` を渡したように候補が 2 つ以上ある場合は既定型を選ばず `E1041` となり、`16i64` のような接尾辞明示を求めます。
- **配列リテラル・ラムダ・`Dyn.of`**: 該当カテゴリの要素型がちょうど 1 つならその期待型で検査します。`([i64] | [i64; 3])` に `[1, 2, 3]` を渡したように動的配列と固定長配列の両方に合致する場合は `E1041` になります。
- **一般式の判定**: それ以外の式は期待型なしで型検査したあと、`U` の一致可能な要素を数えます（1 個なら注入、0 個なら `E1003`、2 個以上なら `E1041`）。なお、期待型のない `let xs = [1, "a"]` で推論が勝手に匿名共用体を合成することはありません（`let xs: [(i64 | string)] = [1, "a"]` と注釈します）。

### 部分共用体の拡大（Widening）

期待型が匿名共用体 `U` の位置に、それより要素数の少ない別の匿名共用体 `V` の**所有値**を渡したとき、$V$ の全要素が $U$ に含まれていれば（$V \subsetneq U$）、ヒープ確保を伴わずにタグだけを付け替えて `U` の値へ自動拡大します。

```tsuzuri run=12px%20auto%2016.5pt
def parse_token :: string -> (i64 | string) = \s ->
    if s == "12" then 12 else "auto"

def render :: own (f64 | i64 | string) -> string = \v ->
    match v with
    | :? f64 as pt -> $"{pt}pt"
    | :? i64 as px -> $"{px}px"
    | :? string as kw -> kw

let narrow: (i64 | string) = parse_token "12"
let numeric: (f64 | i64) = 16.5
$"{render narrow} {"auto" |> parse_token |> render} {render numeric}"
```

拡大に関する境界規則は以下のとおりです。

- `V` に `U` に含まれない要素がある場合は `E1003`（`anonymous_union_not_subset`）になります。
- 拡大できるのは**所有値（または `Copy` 共用体）のみ**です。共有参照 `ref V`（Edition 2027+ で `own` を付けない非 `Copy` 共用体仮引数を含む）や、コレクション内部 `[(i64 | string)]`、比較演算子 `v == w` の右辺は自動拡大されません（非 `Copy` 共用体を拡大して返す関数は仮引数に `own` を付けます）。
- 部分適用 `let f = take_two w` の読み取り引数へ拡大・注入を直接渡すと一時値の借用となり `E1013` になるため、先に `let wide: U = w` で変数に束縛してから渡します。

## 型テストパターン `:? T` と部分絞り込み `:? (A | B)`

### `:? T` による要素の取り出し

匿名共用体の分解には、静的なタグ比較を行う型テストパターン `:? 型` または `:? 型 as 変数名` を用います（実行時型情報 RTTI は使用しません）。

```tsuzuri run=6
let items: [(i64 | string)] = [1, "skip", 2, 3]
let mut total = 0
for item in items do
    match item with
    | :? i64 as n -> total = total + n
    | :? string -> ()
total
```

- `:` と `?` の間に空白は置けません（`: ?` は `E0002`）。関数型や匿名共用体をテストする場合は `:? (i64 -> i64) as f` のように丸括弧で囲みます。
- Edition 2027 以降では、`let`・ラムダ引数・`for ... in` の束縛パターンは反駁不可能でなければならないため（違反時は `E1021`）、`:? T` は必ず `match` 式または関数ガード内で使用します。
- 検査対象の型が匿名共用体に確定していない場合、またはテストした型が要素に含まれない場合は `E1041` になります。ガードなしで全要素を網羅していない `match` は `E1021`（`missing: :? string` など）を報告します。

### `:? (A | B)` による部分共用体への絞り込み（Narrowing）

`:?` の直後に部分集合となる匿名共用体 `(A | B)` を書くと、該当するいずれかの要素であるかを一括判定し、`as sub` で部分共用体 `(A | B)` 型の値として束縛できます。

```tsuzuri run=8%203%20auto
def double_num :: (i64 | f64) -> f64 = \n ->
    match n with
    | :? i64 as i -> (i as f64) * 2.0
    | :? f64 as x -> x * 2.0

def describe :: own (f64 | i64 | string) -> string = \v ->
    match v with
    | :? (i64 | f64) as num -> $"{double_num num}"
    | :? string as text -> text

$"{describe 4} {describe 1.5} {describe "auto"}"
```

絞り込み時の所有権規則は、絞り込み先の型 `(A | B)` が `Copy` かどうかによって決まります。

- **絞り込み先の全要素が `Copy` の場合**（例: `(i64 | f64)`）: 所有値・借用参照・コレクション要素・`when` ガード付きアームのいずれからでも絞り込み可能です。
- **絞り込み先に非 `Copy` 要素が含まれる場合**（例: `(i64 | string)`）: 所有値に対するガードなしのアームでのみペイロードをムーブして新しい部分共用体を構築できます。共有借用（`own` のない仮引数や配列要素を含む）や `when` ガード付きアームで非 `Copy` 部分共用体へ `as` 束縛しようとすると **`E1041`**（`type_test_narrow_borrowed`）になります。

## 所有権・Copy・Send 条件とメモリ表現

匿名共用体は内部的にコンパイラが要素数ごとに合成する共用体と同じ規則に従います。

- **マーカー型クラスの自動成立**: 全要素がそれぞれ `Copy`・`Send`・`Sync`・`Capture` を満たすとき、匿名共用体全体もその性質を持ちます。たとえば `(i64 | bool)` は `Copy` ですが、`(i64 | string)` は非 `Copy` であり注入や拡大のたびに所有権が移動します。
- **メモリレイアウト**: 1 バイトの正準順序タグと最大要素サイズのペイロード領域で構成されます（全要素の表現が同一なら領域を共有、上限 64 KiB で `E1010`）。`union Tree = Leaf | Node of (i64 | Tree)` のように名前付き共用体の再帰サイクルに含まれる場合は自動的にヒープノード化されます。
- **外部境界制限**: `export` / `extern` の C ABI（`E1008`）および GPU カーネル（`E1018`）では使用できません。

## 組み込みの `Eq`・`Ord`・`Hash`・`Display` と `Encode` / `Decode`

### 比較・順序・ハッシュ・表示とリテラルパターン

すべての要素型が対象のクラスを実装していれば、匿名共用体にも自動的に組み込みインスタンスが提供されます（匿名共用体に対するユーザー定義 `instance` は `E1041` で禁止されており、`Default`・`Format`・`Arbitrary` は持ちません）。

| 型クラス | 動作仕様 |
| --- | --- |
| `Eq` | 同じ要素型であればペイロード同士を `==` で比較し、異なる要素型なら常に `false`（リテラルパターン `\| 1 ->` や `\| "x" ->` も利用可能） |
| `Ord` | 先に要素型の**正準順序**で比較し（例: すべての `i64` 値はすべての `string` 値より小さい）、同じ要素型ならペイロードを比較 |
| `Hash` | 正準順序の要素インデックスとペイロードハッシュを混合（同順で宣言した名前付き共用体の `deriving (Hash)` と同一値） |
| `Display` | ケース名や型名を付けず、ペイロード自身の表示結果のみを出力 |

> [!WARNING]
> 比較式 `u == name` の右辺に非 `Copy` の変数 `name`（`string` など）を直接書くと、`name` が匿名共用体へ**注入されてムーブ**されます。比較後も `name` を使いたい場合は `u == clone_string (ref name)` とするか、`match` の `:? string as s -> s == name` で取り出してから比較します。

```tsuzuri run=true%20true%20%5B1%5D%5B2%5D%5Ba%5D
def as_key :: own (i64 | string) -> (i64 | string) = \v -> v

let k1: (i64 | string) = 1
let k2: (string | i64) = "a"
let ordered =
    Set.empty()
    |> Set.insert (as_key "a")
    |> Set.insert (as_key 2)
    |> Set.insert (as_key 1)

let mut buf = ""
for item in Set.iter ordered do
    buf = buf + $"[{item}]"
$"{k1 == 1} {k1 < k2} {buf}"
```

### `Encode` / `Decode`（JSON・CBOR 共通規則）

標準ライブラリの [`Json`](../stdlib/encoding/json.md)（`Json.serialize` / `Json.deserialize`）と [`Cbor`](../stdlib/encoding/cbor.md)（`Cbor.serialize` / `Cbor.deserialize`）はどちらも共通の `Encode` / `Decode` 型クラスを介して動作するため、匿名共用体は **JSON と CBOR の双方でタグなし表現として相互変換**できます。

1. **`Encode`（直列化）**: 全要素が `Encode` を満たすすべての匿名共用体で利用可能です。ラッパーオブジェクトや型タグを一切出力せず、保持しているペイロードの JSON / CBOR 表現をそのまま出力します（`(i64 | f64)` のような重なりのある型でも `Encode` は可能です）。
2. **`Decode`（逆直列化）**: タグが存在しないため、入力データの値種別（`boolean`・`number`・`string`・`array`・`object`）から一意に対応する要素型を選択します。したがって、**各要素が受理する値種別が互いに重ならない匿名共用体のみ**が `Decode` インスタンスを持ちます。

| 要素の型 | `Decode` が受理する値種別 |
| --- | --- |
| `bool` | `boolean` |
| 固定幅整数（`i8`〜`i128u`）・浮動小数点（`f16`〜`f128`, `d32`〜`d128`） | `number` |
| `string`, `utf8string` | `string` |
| `[T]`, `[|T|]`, `Vec<T>`, 2〜4要素タプル, `Set<T>`, `HashSet<T>` | `array` |
| `Map<K, V>`, `HashMap<K, V>` | `object` および `array` の両方 |
| `deriving (Decode)` を持つ `record` | `object` |
| `Maybe<T>`, 名前付き `union`, `Json.Value`, 手書き `Decode` 型 | 複数種別を取り得るため常に他要素と競合 |

`(i64 | f64)`（どちらも `number`）や `(Maybe<i64> | string)` のように値種別が重なる型に対して `Json.deserialize` や `Cbor.deserialize`、あるいはそれを含むレコードの `deriving (Decode)` を要求すると、コンパイルエラー **`E1025`**（`anonymous_union_decode_overlap`）が報告されます。また、レコードの省略可能フィールドを匿名共用体にする場合は、欠落キー（`null`）を受け取れるよう外側に `Maybe<(i64 | string)>` を被せます。

```tsuzuri run=%7B%22key%22%3A%22port%22%2C%22val%22%3A8080%7D%20true%20true
record ConfigItem {
    key: string,
    val: (i64 | string | bool)
} deriving (Eq, Encode, Decode)

let item1 = ConfigItem { key: "port", val: 8080 }
let item2 = ConfigItem { key: "mode", val: "fast" }

let json_raw = Json.serialize (ref item1) |> Result.get
let from_json: ConfigItem = Json.deserialize (ref json_raw) |> Result.get

let cbor_raw = Cbor.serialize (ref item2) |> Result.get
let from_cbor: ConfigItem = Cbor.deserialize (ref cbor_raw) |> Result.get

$"{String.from_utf8 (ref json_raw)} {from_json == item1} {from_cbor == item2}"
```

## 名前付き `union` との使い分け

| 判断基準 | 匿名共用体 `(A \| B)` | 名前付き `union` |
| --- | --- | --- |
| 主な用途 | 複数型の引数を受け取る関数（オーバーロード代替）、タグなし異種 JSON / CBOR データ | ドメイン固有の状態・構文木・エラー型・Newtype |
| 同一型の複数ケース | 不可（`E1041`） | 可能（`Celsius of f64 \| Fahrenheit of f64`） |
| 部分集合の自動拡大・絞り込み | 自動拡大と `:? (A \| B)` に対応 | 不可（明示的な変換関数を記述） |
| JSON / CBOR 形式 | タグなし（値種別が互いに素な場合のみ `Decode` 可） | タグ付き `"Case"` / `{"Case": v}`（同種型でも `Decode` 可） |
| 独自インスタンス・`Default` | 不可（組み込み規則のみ） | `deriving` および手書き `instance` が可能 |

## 関連項目

- [型システムの概要](overview.md)
- [判別共用体](unions.md)
- [型推論](type-inference.md)
- [型クラス](type-classes.md)
- [パターンマッチング](../expressions/pattern-matching.md)
- [Json](../stdlib/encoding/json.md)
- [Cbor](../stdlib/encoding/cbor.md)
