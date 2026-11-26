# Text

`Text` は、`string`（UTF-16）と `utf8string`（UTF-8）が共通して備える長さ取得・検索・切り出し・分割・連結・ASCII 変換を単一のインターフェースに統合する標準型クラス（`std/Text.tt`）です。`Text<'s> =>` 制約を用いることで、文字エンコーディングに依存しない汎用的なテキスト処理関数をゼロオーバーヘッドの静的特殊化で記述できます。

個々の型固有の仕様については[`String`](string.md)・[`Utf8String`](utf8string.md)・[文字列](../../syntax/strings.md)を、型クラス機構全般については[型クラス](../../types/type-classes.md)を参照してください。

## 要点

- `Text.find`・`Text.split`・`Text.trim` などのメソッドは、引数が `string` であれば `String` の同名関数へ、`utf8string` であれば `Utf8String` の同名関数へ直接委譲されます。
- スーパークラスとして `Ord<'s>`（したがって `Eq<'s>` も）を要求するため、`Text<'s> =>` 制約下のジェネリック関数内では `==` や `<` による比較もそのまま使用できます。
- 辞書渡しや動的ディスパッチ（vtable）は発生せず、呼び出しは具体型ごとに静的特殊化され、最適化ビルド（`-O1` 以上）では直接呼び出しと同等にインライン展開されます（`dyn Text` は `E1028` で禁止）。
- 長さ・オフセット・スライス境界・辞書順の意味は元の型（`string` はコード単位、`utf8string` はバイトおよびスカラー境界）をそのまま引き継ぎます。

## 基本的な使い方とジェネリック関数

具体的な `string` や `utf8string` に対して直接 `Text` のメソッドを呼び出すことも、`Text<'s> =>` 制約を持つジェネリック関数を定義することもできます。

```tsuzuri run=4%204%200%20true%20false
def count_words :: Text<'s> => ref 's -> ref 's -> i64
fn count_words separator text =
    let trimmed = Text.trim text
    if Text.is_empty (ref trimmed) then 0 else (Text.split separator (ref trimmed)).length

def earlier :: Text<'s> => ref 's -> ref 's -> bool
fn earlier left right = deref left < deref right

let a = count_words " " "  to be or not  "
let b = count_words u8" " u8"  to be or not  "
let c = count_words " " ""
let d = earlier "apple" "banana"
let e = earlier u8"banana" u8"apple"
$"{a} {b} {c} {d} {e}"
```

型クラス名やメソッド名がユーザー定義の識別子と衝突する場合は、`Text.Text<'s>` や `Text.Text.length` のようにモジュール修飾名で参照できます（標準モジュール `Text` が予約されているため、ユーザー側で `Text.tz` や `namespace Text` を定義すると `E1011` になります）。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)に従い、`Text` の全メソッドでも操作対象のテキスト `'s`（または配列 `['s]`）が最後の引数です。検索パターン・区切り・開始位置・個数は対象テキストの前に置かれます。

```tsuzuri run=word%3Dsuz%20loud%3DSUZ%20at%3D2
let middle = Text.sub 1 3 >> Maybe.default_value u8""
let word = u8"Tsuzuri" |> middle
let loud = word |> Text.to_ascii_upper
let z = u8"z"
let at = word |> Text.find z |> Maybe.default_value (-1)
$"word={word} loud={loud} at={at}"
```

部分適用 `Text.find z` を行う場合は、`String.find` と同様に借用対象の引数をあらかじめ `let` で変数に束縛してから渡します（一時値を部分適用で借用すると `E1013` となります）。

## メソッド一覧（全 21 メソッド）

型定義は `class Ord<'s> => Text<'s>` です。`is_empty` のみ既定実装（`Text.length text == 0`）を持ち、他の 20 メソッドは各インスタンスが実装します。

| メソッド | シグネチャ | `string` での委譲先 | `utf8string` での委譲先 |
| --- | --- | --- | --- |
| `Text.length` | `ref 's -> i64` | `String.length` | `Utf8String.length` |
| `Text.is_empty` | `ref 's -> bool` | 既定実装（`length == 0`） | 既定実装（`length == 0`） |
| `Text.compare` | `ref 's -> ref 's -> i64` | `String.compare` | `Utf8String.compare` |
| `Text.clone` | `ref 's -> 's` | `clone_string` | `Utf8String.clone` |
| `Text.find` | `ref 's -> ref 's -> Maybe<i64>` | `String.find` | `Utf8String.find` |
| `Text.rfind` | `ref 's -> ref 's -> Maybe<i64>` | `String.rfind` | `Utf8String.rfind` |
| `Text.contains` | `ref 's -> ref 's -> bool` | `String.contains` | `Utf8String.contains` |
| `Text.starts_with` | `ref 's -> ref 's -> bool` | `String.starts_with` | `Utf8String.starts_with` |
| `Text.ends_with` | `ref 's -> ref 's -> bool` | `String.ends_with` | `Utf8String.ends_with` |
| `Text.slice` | `i64 -> i64 -> ref 's -> Maybe<'s>` | `String.slice` | `Utf8String.slice` |
| `Text.sub` | `i64 -> i64 -> ref 's -> Maybe<'s>` | `String.sub` | `Utf8String.sub` |
| `Text.join` | `ref 's -> ref ['s] -> 's` | `String.join` | `Utf8String.join` |
| `Text.concat` | `ref ['s] -> 's` | `String.concat` | `Utf8String.concat` |
| `Text.split` | `ref 's -> ref 's -> ['s]` | `String.split` | `Utf8String.split` |
| `Text.trim` | `ref 's -> 's` | `String.trim` | `Utf8String.trim` |
| `Text.trim_start` | `ref 's -> 's` | `String.trim_start` | `Utf8String.trim_start` |
| `Text.trim_end` | `ref 's -> 's` | `String.trim_end` | `Utf8String.trim_end` |
| `Text.to_ascii_lower` | `ref 's -> 's` | `String.to_ascii_lower` | `Utf8String.to_ascii_lower` |
| `Text.to_ascii_upper` | `ref 's -> 's` | `String.to_ascii_upper` | `Utf8String.to_ascii_upper` |
| `Text.repeat` | `i64 -> ref 's -> 's` | `String.repeat` | `Utf8String.repeat` |
| `Text.replace` | `ref 's -> ref 's -> ref 's -> 's` | `String.replace` | `Utf8String.replace` |

特に `Text.clone` は、`string` 側の `clone_string` と `utf8string` 側の `Utf8String.clone` という非対称な関数名を統一的に呼び出せる入口としても有用です。

## 型ごとに残る意味の差と除外されている操作

`Text` はエンコーディング固有の単位や境界条件を隠蔽せず、各型の契約をそのまま保ちます。

| 観点 | `string` インスタンス | `utf8string` インスタンス |
| --- | --- | --- |
| 長さ・オフセットの単位 | UTF-16 コード単位 | UTF-8 バイト |
| `slice` / `sub` の境界 | サロゲートペアの途中でも切り出し可能 | 始点・終点がスカラー境界でなければ `None` |
| 空パターンの `split` / `replace` | コード単位の境界ごと | Unicode スカラーの境界ごと |
| `compare` と `<` の順序 | 符号なし 16 ビットコード単位順 | 符号なしバイト順（スカラー順と一致） |
| 結果長の上限 | $2^{53} - 1$ コード単位 | `i64` の最大値バイト |

```tsuzuri run=3%207%202%20-1%203
def cut_length :: Text<'s> => ref 's -> i64 -> i64 -> i64
fn cut_length text first last =
    match Text.slice first last text with
    | Some part -> Text.length (ref part)
    | None -> -1

let word = "あ😀"
let bytes = u8"あ😀"
$"{Text.length word} {Text.length bytes} {cut_length word 1 3} {cut_length bytes 1 3} {cut_length bytes 0 3}"
```

一方で、型ごとに意味や要素型が異なる以下の操作は意図的に `Text` から除外されています。

- **`char_count`・`chars`・`decode_at`**: `String.char_count` はコード単位数（$O(1)$）、`Utf8String.char_count` はスカラー数（$O(n)$）であり、要素型も `char` と `utf8char` で異なるため。
- **生の配列変換・相互変換・整形式検査**: `to_code_units` / `to_bytes`、`String.from_utf8` / `Utf8String.from_string`、`String.is_well_formed` / `to_well_formed` はエンコーディング固有の操作であるため。

## 型推論・借用・独自インスタンス実装上の注意

- **戻り値型が `'s` のメソッドのネスト呼び出し**: `Text.trim` や `Text.clone` のように戻り値が型変数 `'s` で決まる呼び出しを、別の借用引数位置へそのまま `Text.length (Text.trim text)` のように渡すと、`'s` が参照型と推論されて型不一致（`E1003` または `E1005`）となる場合があります。一時変数 `let trimmed = Text.trim text` に束縛するか、`Text.length (ref (Text.trim text))` のように `ref` を明示してください。同様に `Text<'s> =>` 制約下のジェネリック関数内で 2 引数以上のメソッドへ一時値を渡す場合も、先に `let` で束縛します（`E1013` 回避）。
- **ユーザー定義型への実装**: `Eq` および `Ord` インスタンスを備える任意のユーザー定義型に対して `instance Text<MyType>` を実装できます（スーパークラス不足は `E1027`、`is_empty` 以外の必須メソッド欠落は `E1016`）。正規表現側で両文字列型を共通化する場合は[`Regex`](regex.md)の `RegexText` 型クラスを参照してください。

## 関連項目

- [String](string.md)
- [Utf8String](utf8string.md)
- [Regex](regex.md)
- [文字列](../../syntax/strings.md)
- [型クラス](../../types/type-classes.md)
- [借用と参照](../../ownership/borrowing.md)
- [標準ライブラリの設計規約](../conventions.md)
