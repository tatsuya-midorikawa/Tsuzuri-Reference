# 型クラス

型クラスは、特定の型に対して利用可能な演算・変換・性質の契約を静的に定義する仕組みです。算術演算子 `+` や等値比較 `==`、JSON / CBOR 変換、スコープ終了時のリソース解放 `Drop`、および並行安全性のマーカー `Send` / `Sync` はすべて型クラスによって統一的に管理されます。通常はコンパイル時の単相化によってゼロオーバーヘッドの直接関数呼び出しへ解決され、異なる型の値を単一コレクションへ混在させたい場合に限り `dyn C` による明示的な動的ディスパッチを使用します。

## 要点

- **宣言ファイルの分離と一貫性**: `class` 宣言は `.tt` ファイル、`instance` 実装は `.tz` または `.tc` ファイルに記述します。重複・競合するインスタンスは優先順位を付けず `E1016` として拒否されます。
- **純粋メソッド・デフォルト実装・継承**: クラスメソッドには副作用のない契約を強制する `pure def`、省略可能なデフォルト実装、およびスーパークラス制約（`class Eq<'a> => ...`）を指定できます。
- **全 36 個の標準組み込み型クラス**: 算術・ビット・添字（`Index` / `IndexMut`）・比較・表示・シリアライズ・`Drop`・所有権/並行マーカーが言語に組み込まれています。
- **演算子拡張インスタンス（OEI）とオーファン規則**: 3 型引数 `Mul<Left, Right, Output>` 等の異種型間算術を定義でき、オーファン規則（`E1016` `orphan_instance`）と曖昧候補検出（`E1043`）によってプログラム全体の一貫性が保たれます。
- **自動導出と `dyn` 動的ディスパッチ**: `deriving` により 8 種類の基本クラスを構造から自動生成でき、`dyn C` と `Dyn.of` により vtable ベースの動的ディスパッチを行えます。

## `class` 宣言と `instance` 宣言

### クラス宣言（`.tt`）とインスタンス実装（`.tz` / `.tc`）

ユーザー定義の型クラスは拡張子 **`.tt`** のモジュールファイルに宣言します（`.tz` や `.tc` に `class` を置くと `E1018` になります。1 つの `.tt` ファイルに複数のクラスを定義可能です）。

- **メソッド定義（`def` / `pure def`）**: クラス内の各メソッドは `def name :: ...` または **`pure def name :: ...`** で型シグネチャを宣言します。メソッドを 1 つも持たない空のクラス宣言や、値型カインド `*` のクラスにおけるメソッド固有の余分な型変数・制約は `E1016` になります。
- **純粋メソッド（`pure def`）**: メソッドに `pure def` を指定すると、デフォルト実装およびすべての `instance` 実装に対して純粋関数契約（入出力・外部呼び出し・時計・乱数・共有可変状態・`dyn` 呼び出し・`ref mut` 引数の禁止）が課され、未使用のインスタンスであっても違反時は **`E1029`** エラーになります。高階関数を返すファクトリメソッドでは `pure def make :: own 'a -> (i64 -> i64)` が構築段階のみの純粋性を、`A -> pure (B -> C)` が返却関数実行時までの純粋性を表します。
- **デフォルト実装とスーパークラス**: `class Eq<'a> => PrintableEq<'a>` のようにスーパークラスを要求でき、デフォルト実装を持つメソッドは `instance` 側で省略可能です（すべて省略する場合は `instance C<T> {}`）。スーパークラスの未実装や循環継承、未宣言のコンテキスト制約は `E1027` になります。

```tsuzuri project=class-demo file=Metrics.tt
class Measure<'a> {
    pure def weight :: 'a -> i64
}

class (Eq<'a>, Measure<'a>) => Ranked<'a> {
    pure def heavier_than :: 'a -> 'a -> bool = \left right ->
        Measure.weight left > Measure.weight right
}
```

```tsuzuri project=class-demo file=Main.tz run=true:35
record Parcel { kg: i64 } deriving (Eq)

instance Metrics.Measure<Parcel> {
    fn weight p = p.kg
}

instance Metrics.Ranked<Parcel> {}

pure def total_weight :: Metrics.Measure<'a> => 'a -> 'a -> i64 = \a b ->
    Metrics.Measure.weight a + Metrics.Measure.weight b

let p1 = Parcel { kg: 20 }
let p2 = Parcel { kg: 15 }
$"{Metrics.Ranked.heavier_than p1 p2}:{total_weight p1 p2}"
```

### 条件付きインスタンスと重複禁止（Coherence）

`instance Eq<'a> => Eq<Box<'a>>` のように型パラメータへの制約付きの条件付きインスタンスを定義できます。同一クラスに対して単一化可能なヘッドを持つ複数のインスタンス（例: `Eq<Box<'a>>` と `Eq<Box<i64>>`）は具体度による優先解決を行わず、ファイル順に関わらず重複エラー **`E1016`**（`overlapping_instance`）となります（型エイリアスは展開後の型で比較されます）。

なお、インスタンス解決の最大ネスト深度は 64、単一制約から派生する個別要件数は最大 128 個であり、超過すると `E1017` になります。

## 標準組み込み型クラス一覧（全 36 クラス）

言語には以下の **36 個**の組み込み型クラスが予約されており（同名のレコードやクラス宣言は `E1001`）、これに加えて標準ライブラリが [`Text.Text`](../stdlib/text/text.md)・[`Monoid.Monoid`](../stdlib/core/monoid.md)・`RegexText.RegexText` を `.tt` で提供しています。

### 演算子・添字クラス（10 クラス）

| クラス | メソッド / 対応構文 | 仕様と組み込み実装 |
| --- | --- | --- |
| `Add` | `add` / `l + r` | 全数値型、SIMD、`string`、`utf8string`。ユーザー・標準ライブラリ型のインスタンスは `ref` 共有借用で被演算子を受け取る（3 型引数 OEI 対応） |
| `Sub`, `Mul`, `Div` | `sub`, `mul`, `div` / `-`, `*`, `/` | 全数値型、SIMD（3 型引数 OEI 対応） |
| `Rem` | `rem` / `l % r` | 全固定幅整数型（3 型引数 OEI 対応） |
| `Pow` | `pow` / `l ** r` | 全固定幅整数型、`f32`、`f64`（3 型引数 OEI 対応） |
| `Neg` | `neg` / 単項 `-x` | 符号付き整数型、全浮動小数点型、符号付き・浮動小数点 SIMD（2 型引数 `Neg<S, O>` OEI 対応） |
| `Bits` | `bit_and`, `bit_or`, `bit_xor`, `shl`, `shr`, `ushr`, `bit_not` / `&`, `\|`, `^`, `<<<`, `>>>`, `>>>>`, `~~~` | 全固定幅整数型、整数・マスク SIMD |
| `Index` | `index :: ref Key -> ref Self -> Output` / `x[k]`, `x[i, j]`, `ref x[0..<2, ..]` | 3 型引数 `Index<Self, Key, Output>`。`Tensor`・`Matrix`・`MatrixView`・`Map`・`HashMap` やユーザー定義型にブラケット添字を開放する。借用ビューを返す場合は呼び出し側で `ref x[...]` が必須（欠落時は `E1042`） |
| `IndexMut` | `index_mut :: ref Key -> own Value -> ref mut Self -> unit` / `x[k] = v` | 3 型引数 `IndexMut<Self, Key, Value>`。可変な所有者・排他参照に対する添字代入を開放する |

### 比較・フォーマット・シリアライズ・解放クラス（12 クラス）

| クラス | メソッドシグネチャ | 仕様と主な対象型 |
| --- | --- | --- |
| `Eq` | `eq`, `ne :: ref 'a -> ref 'a -> bool` | `==`, `!=`。全プリミティブ型、文字列、要素が `Eq` の配列・リスト・タプル・匿名共用体 |
| `Ord`（要 `Eq`） | `lt`, `le`, `gt`, `ge :: ref 'a -> ref 'a -> bool` | `<`, `<=`, `>`, `>=`。`bool` と `unit` を除く全プリミティブ型、文字列、要素が `Ord` の配列・リスト・タプル・匿名共用体 |
| `Hash` | `hash :: ref 'a -> i64u` | 64 bit FNV-1a ハッシュ。全プリミティブ型、文字列、要素が `Hash` の配列・リスト・タプル・匿名共用体 |
| `Display` | `display :: ref 'a -> string` | `to_string` および文字列補間 `$"..."`。全数値型、`bool`、`unit`、文字列、配列・リスト・タプル・匿名共用体 |
| `Format` | `format :: ref 'a -> ref string -> string` | 書式指定付き補間 `$"{v:spec}"`。プログラム内の `record` / `union` にも実装可能 |
| `Parse` | `parse :: ref string -> Maybe<'a>` | 文字列からの復元。全固定幅整数型、全浮動小数点型、`bool` |
| `Default` | `default :: 'a`（`Default.default()` で呼び出し） | 既定値（0、`false`、`()`、`""`、`[]`、`[||]`、タプル） |
| `Arbitrary` | `arbitrary :: Gen<'a>`（`Arbitrary.arbitrary()`） | プロパティベーステスト [`Gen`](../stdlib/testing/gen.md) のランダム値生成器 |
| `Encode` | `encode :: ref 'a -> Result<Json.Value, Json.Error>` | [`Json`](../stdlib/encoding/json.md) および [`Cbor`](../stdlib/encoding/cbor.md) への直列化 |
| `Decode` | `decode :: ref Json.Value -> Result<'a, Json.Error>` | `Json` および `Cbor` からの逆直列化 |
| `Err` | `msg :: ref 'a -> string` | `try ... with` ハンドラが返すエラー型の説明文字列（`Exception` が実装） |
| `Drop` | `drop :: ref mut 'a -> unit` | スコープ終了時の決定論的デストラクタ（他の言語の `IDisposable` / `Dispose` に相当する役割も `Drop` と [`use` 束縛](../expressions/resources-and-assertions.md)・`Owned.drop` で担い、独立した `Dispose` 型クラスはありません）。式からの `Drop.drop` 直接呼び出しは `E1016` で禁止 |

### 所有権・並行・数値・SIMD マーカークラス（14 クラス）

以下の 14 クラスはメソッドを持たないコンパイラ組み込みマーカー（印）であり、ユーザーによる `instance` 定義や上書きはすべて `E1016` として拒否されます。

| 分類 | クラス名 | 満たす条件・対象型 |
| --- | --- | --- |
| 所有権・クロージャ | `Copy` | 複製後も元を使用可能な型（スカラー、`ref T`、関数値、全要素が `Copy` の非 `Drop`・非再帰複合型） |
| 所有権・クロージャ | `Capture` | 再利用可能なクロージャ環境へ捕捉できる型（`ref mut T`、`Drop` 型、非 `copy` ハンドル、`Rc`、`Atomic`、`Mutex`、`Owned.Function` は不可） |
| 並行処理 | `Send` | 他の `tzroutine` やスレッドへ所有権を送信できる型（借用参照や `Rc` を含まない型、`dyn (C, Send)`、`T: Send + Sync` の `Arc<T>`） |
| 並行処理 | `Sync` | 複数 `tzroutine` / スレッド間で共有参照 `ref T` を同時共有できる型（`Rc`、`Seq`、非 `Copy` の `dyn`、`Owned.Function` 等を除く） |
| 並行処理 | `AtomicValue` | [`Atomic<T>`](../stdlib/sync/atomic.md) に格納可能な型（8〜64 bit の符号付き・符号なし整数および `bool` のみ） |
| 数値分類 | `Numeric` | 固定幅整数・2進浮動小数点・10進浮動小数点の全 17 数値型（`as` キャストの対象） |
| 数値分類 | `Integer`, `SignedInteger`, `UnsignedInteger` | 全固定幅整数型 / 符号付き整数型 / 符号なし整数型 |
| 数値分類 | `Float`, `Elementary` | 2進・10進の全浮動小数点型 / 初等超越関数の対象である `f32` と `f64` のみ |
| SIMD 分類 | `SimdVector`, `SimdNumeric`, `SimdMask` | 全 SIMD ベクトル・マスク型 / 数値レーン SIMD 型 / マスク SIMD 型 |

## 演算子拡張インスタンス（NC19）・オーファン規則・曖昧候補エラー

### 演算子拡張インスタンス（OEI）

組み込み算術クラスのうち、二項の `Add`・`Sub`・`Mul`・`Div`・`Rem`・`Pow` には **3 型引数 `Class<Left, Right, Output>`**、単項の `Neg` には **2 型引数 `Neg<Self, Output>`** の拡張インスタンス（Operator Extension Instance）を定義できます。メソッド引数はすべて共有借用（`ref Left -> ref Right -> Output`、`ref Self -> Output`）として渡されるため、`Tensor` や非 `Copy` レコードも所有権を消費せずに数式を組み立てられます。

```tsuzuri run=20:30:-20
record Vec2<'a> { x: 'a, y: 'a }
record NegVec2<'a> { x: 'a, y: 'a }

instance (Mul<'a>, Copy<'a>) => Mul<Vec2<'a>, 'a, Vec2<'a>> {
    fn mul v k = Vec2 { x: v.x * deref k, y: v.y * deref k }
}

instance (Mul<'a>, Copy<'a>) => Mul<'a, Vec2<'a>, Vec2<'a>> {
    fn mul k v = Vec2 { x: deref k * v.x, y: deref k * v.y }
}

instance (Neg<'a>, Copy<'a>) => Neg<Vec2<'a>, NegVec2<'a>> {
    fn neg v = NegVec2 { x: -v.x, y: -v.y }
}

let base = Vec2 { x: 2, y: 3 }
let scaled = 2 * (base * 5)
let inverted = -scaled
$"{scaled.x}:{scaled.y}:{inverted.x}"
```

拡張インスタンスは以下の形式規則（違反時は **`E1016`** `operator_instance_form`）に従います。

1. **名前付き型の必須条件**: `Left` と `Right`（`Neg` では `Self`）の少なくとも一方の先頭型構築子は、プリミティブでない名前付き型（`record`・名前付き `union`・`extern type`）でなければなりません（`Mul<i64, f64, f64>` は不可）。
2. **同型 3 引数の禁止**: `Add<Money, Money, Money>` のように 3 型すべてが同一の定義は書けません（通常の 1 引数 `instance Add<Money>` を使用します）。
3. **裸の型変数の被覆規則（Coverage Rule）**: 一方のオペランドが裸の型変数 `'a` である場合、もう一方のオペランド型の内部にも `'a` が出現していなければなりません。上の `Mul<Vec2<'a>, 'a, Vec2<'a>>` は `'a` が `Vec2<'a>` に含まれるため受理されますが、`Mul<Money, 'b, Money>` は被覆されていないため `E1016` として拒否されます（また、`Output` やコンテキスト制約にヘッド外の未束縛型変数を書くことは `E1027` になります）。
4. **単一演算子表での重複検査と適用範囲**: 1 引数の同型インスタンスと OEI は同一の演算子テーブルで管理され、ヘッドが単一化可能な組み合わせは宣言順を問わず `E1016`（`overlapping_instance`）となります。なお、OEI は演算子構文（`a * b`、`-v`）にのみ適用され、`Mul<'a> =>` 制約や `Mul.mul` メソッド値の対象にはなりません。

### オーファン規則（`E1016` `orphan_instance`）

他パッケージや標準ライブラリの型同士に対する演算の勝手な衝突を防ぐため、`Index`・`IndexMut` およびすべての算術演算子クラス（`Add`〜`Pow`・`Neg` の 1 引数形と OEI の双方）のユーザー定義インスタンスには**オーファン規則（orphan rule）**が適用されます。

- **規則**: ディスパッチ対象の型位置（`Index` / `IndexMut` では `Self` と `Key`、1 引数算術では `T`、3 引数 OEI では `Left` と `Right`、2 引数 `Neg` では `Self`。**出力型 `Output` や `Value` は対象外**）のうち少なくとも 1 つの先頭型構築子が、**現在のプログラム内で宣言された `record`・名前付き `union`・`extern type` のいずれか**でなければなりません（同一プログラム内の別ユーザーモジュールで宣言された型でも構いません）。
- **違反時の診断と対処**: `instance Mul<Tensor<f64>, f64, Tensor<f64>>` や `instance Add<i64>` のように標準ライブラリ型や組み込み型のみで構成されたインスタンスは **`E1016`**（`orphan_instance`）になります。標準ライブラリの型に独自の演算や添字を与えたい場合は、`record Prices { data: Tensor<f64> }` のように自プログラムのレコードや共用体でラップして定義します。

### 曖昧候補エラー（`E1043` `ambiguous_instance_candidates`）

拡張インスタンスや複数キー型の `Index` / `IndexMut` において、型推論後に一致し得るインスタンス候補が 2 つ以上残った場合、コンパイラは先頭の宣言を恣意的に選ぶことはせず **`E1043`**（`ambiguous_instance_candidates`）を報告します。たとえば `Mul<Money, i32, Money>` と `Mul<Money, i64, Money>` の両方を定義した状態で接尾辞なしリテラル `price * 3` を書いた場合は `E1043` となり、`price * 3i64` のように型を明示することで解消できます。

## 自動導出 `deriving`

`record` および名前付き `union` の宣言末尾に `deriving (...)` を付与すると、同じモジュール内に構造的なインスタンスが自動生成されます。

| 導出可能クラス | 生成される動作の概要 | 主な制約・エラー条件 |
| --- | --- | --- |
| `Eq` | 宣言順のフィールド比較 / タグとペイロード比較（短絡評価） | 全構成要素に `Eq` が必要 |
| `Ord` | 宣言順の辞書式比較（共用体は先頭ケースが最小） | 同じ型に `Eq` が必須（欠落時は `E1025`） |
| `Display` | `Point { x: 1, y: 2 }` / `Ready 42` 形式の文字列化 | 全構成要素に `Display` が必要 |
| `Hash` | 64 bit FNV-1a による決定論的ハッシュ計算 | 全構成要素に `Hash` が必要（暗号学的耐性はなし） |
| `Default` | 全フィールドの既定値 / 共用体の先頭ケースの既定値 | 先頭ケースが無限再帰する場合は `E1025` |
| `Arbitrary` | プロパティテスト用の構成要素結合 / 等確率ケース選択生成器 | 再帰的な型は導出不可（`E1025`） |
| `Encode` / `Decode` | JSON・CBOR のオブジェクト / ケース表現との相互変換 | `@json "名前"` でキー・ケース名を変更可能（重複名は `E1025`） |

同じクラスの重複指定は `E1001`、手書き `instance` との競合は `E1016`、上記 8 クラス以外（`Drop` やユーザー定義クラスなど）の指定は `E1025`、プロジェクト全体の導出インスタンス数が 1,024 個を超えると `E1017` になります。

## 動的ディスパッチ `dyn C` と `Dyn.of`

コンパイル時に単一の具象型へ絞れない異種オブジェクトのコレクションを扱う場合は、動的ディスパッチ型 **`dyn C`**（データポインタと静的 vtable ポインタからなる 2 ワードの所有ファットポインタ）を使用します。

### 構築・複数クラス・マーカー印・リージョン

- **型表記**: 単一クラス `dyn Shapes.Shape`、複数クラスとマーカー印の組み合わせ `dyn (Shapes.Shape, Display, Copy, Send)`、または借用を保持するリージョン付き `dyn Shapes.Shape {r}` を記述できます（`ref dyn C` は `ref (dyn C)` と解釈されます）。
- **明示構築 `Dyn.of`**: 暗黙の型変換は行われず、期待型が `dyn` 型に確定している位置で **`Dyn.of value`** を呼び出してヒープ領域へ格納します（期待型がない文脈での `Dyn.of` は `E1015`）。すでに対象クラス群を包含する `dyn` 値を `Dyn.of` に渡した場合は、再確保を行わず vtable ポインタのみを付け替えるゼロアロケーションのアップキャストになります。

| 型表記 | `Copy` | `Send` | 借用の保持 | 特徴 |
| --- | --- | --- | --- | --- |
| `dyn C` | × | × | 不可（`E1013`） | 基本の単一所有動的オブジェクト（スコープ終了時に格納値の `Drop` と領域解放を実行） |
| `dyn (C, Copy)` | ○ | × | 不可（`E1013`） | 複製時に格納値をヒープ上へディープコピーする（`Capture` も満たす） |
| `dyn (C, Send)` | × | ○ | 不可（`E1013`） | `tzroutine` や `Channel<dyn (C, Send)>`、`Parallel.*` でスレッド間移動が可能 |
| `dyn C {r}` | × | ×（`Send` 併用は `E1028`） | リージョン `r` の共有借用を保持可 | 生存期間 `r` 内で借用を含むレコード等を動的ディスパッチ可能 |

### `dyn` 互換（オブジェクト安全性）規則

クラス `C`（およびその全スーパークラス）を `dyn` 型として使用するには、以下の条件をすべて満たす必要があります。違反する場合は具体的な理由を伴う **`E1028`** エラーになります。

1. カインドが通常の値型 `*`（1 型変数）であり、少なくとも 1 つ以上のメソッドを持つこと（高階カインド型クラスやマーカー単独の `dyn Copy` は不可）。
2. すべてのメソッドの第 1 引数が受け手（`'a`・`ref 'a`・`ref mut 'a` のいずれか）であり、**第 2 引数以降および戻り値型にクラスの型変数 `'a` が現れないこと**（たとえば `Eq` は第 2 引数にも `ref 'a` を取るため `dyn Eq` にはできません）。
3. `Drop` および `Sync` マーカーを並べることはできません（メソッドなしのスーパークラスとして許容される印は `Copy` と `Send` のみです）。また `dyn` 値は C ABI（`export` / `extern`）には渡せません（`E1008`）。

```tsuzuri project=dyn-shapes file=Shapes.tt
class Shape<'a> {
    def area :: ref 'a -> i64
}
```

```tsuzuri project=dyn-shapes file=Main.tz run=Square%3D9%2C%20Rect%3D20
record Square { side: i64 } deriving (Display)
record Rect { w: i64, h: i64 } deriving (Display)

instance Shapes.Shape<Square> {
    fn area s = s.side * s.side
}

instance Shapes.Shape<Rect> {
    fn area r = r.w * r.h
}

let items: [dyn (Shapes.Shape, Copy)] = [
    Dyn.of (Square { side: 3 }),
    Dyn.of (Rect { w: 4, h: 5 })
]
let first_copy = items[0]
$"Square={Shapes.Shape.area (ref first_copy)}, Rect={Shapes.Shape.area (ref items[1])}"
```

## 関連項目

- [型システムの概要](overview.md)
- [ジェネリクス](generics.md)
- [型推論](type-inference.md)
- [レコード](records.md)
- [判別共用体](unions.md)
- [匿名共用体](anonymous-unions.md)
- [演算子](../expressions/operators.md)
- [関数](../expressions/functions.md)
- [Drop とリソース解放](../ownership/drop.md)
- [リソース管理とアサーション](../expressions/resources-and-assertions.md)
- [Json](../stdlib/encoding/json.md)
- [Cbor](../stdlib/encoding/cbor.md)
