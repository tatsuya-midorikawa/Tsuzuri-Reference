# Unicode

`Unicode` は、Unicode 文字データベース（UCD）バージョン **17.0.0** に基づく一般カテゴリ判定、正規化（UAX #15: NFC / NFD / NFKC / NFKD）、拡張書記素クラスタおよび単語境界分割（UAX #29）、ならびに完全な大小文字変換・ケースフォールディングを提供する opt-in 標準モジュールです。`string`（UTF-16）向け関数と `utf8string`（UTF-8）向け関数（`_utf8` 接尾辞）の双方を備えています。

UCD テーブル（`src/runtime/unicode.ll`）は `Unicode` または[`Regex`](regex.md)を参照するプログラムにのみリンクされるため、使用しないバイナリや WebAssembly モジュールのサイズには影響しません。

## 要点

- 準拠する Unicode バージョンは `17.0.0` に固定されており、`Unicode.version ()` で取得できます。
- `Unicode.category` は `utf8char` 1 文字の一般カテゴリを 30 バリアントの共用体 `Unicode.Category`（`Lu`〜`Cn`）で返します。
- `normalize` / `is_normalized` は正準分解・互換分解と正準合成（`Nfc`・`Nfd`・`Nfkc`・`Nfkd`、ハングル音節の算術分解・合成を含む）を実行します。
- `graphemes` / `words` と各 `*_boundaries` は UAX #29 の既定境界規則（インド系文字結合 GB9c や絵文字 ZWJ 列 GB11 を含む）に従い、ロケールや辞書に依存しません。
- `to_lower`・`to_upper`・`to_title`・`case_fold` は `SpecialCasing.txt`（ドイツ語 `ß` → `SS` やギリシャ語語末シグマ `Σ` → `ς` など文字数が変化する変換を含む）に対応したロケール非依存の完全変換です。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)に従い、文字列を変換・分割するすべての関数は対象文字列（`ref string` または `ref utf8string`）を最後の引数に取ります。`normalize` および `is_normalized` では正規化形式 `NormalizationForm` が第 1 引数、対象文字列が第 2 引数となるため、`"é" |> Unicode.normalize Unicode.Nfd` のようにパイプラインで記述できます。

## データ型

```text
union Category =
    | Lu | Ll | Lt | Lm | Lo
    | Mn | Mc | Me
    | Nd | Nl | No
    | Pc | Pd | Ps | Pe | Pi | Pf | Po
    | Sm | Sc | Sk | So
    | Zs | Zl | Zp
    | Cc | Cf | Cs | Co | Cn
    deriving (Eq, Display)

union NormalizationForm = Nfc | Nfd | Nfkc | Nfkd deriving (Eq, Display)
```

`utf8char` はサロゲート値を取り得ないため、`Unicode.category` が `Cs` を返すことはありません（`Cs` は `property_ranges "Cs"` との一貫性のために定義されています）。また、`string` 版の各関数に孤立サロゲートが含まれる場合、トラップせずそのままの位置・コード単位で保持されます。

## 公開関数一覧（全 24 関数）

### バージョン・UCD テーブル参照・一般カテゴリ（4 関数）

| 関数 | シグネチャ | 計算量 | 説明 |
| --- | --- | --- | --- |
| `Unicode.version` | `unit -> string` | $O(1)$ | UCD のバージョン文字列 `"17.0.0"` を返す |
| `Unicode.category` | `utf8char -> Unicode.Category` | $O(\log t)$ | スカラー値の一般カテゴリを二分探索で返す |
| `Unicode.property_ranges` | `ref string -> Maybe<[(i64 * i64)]>` | $O(t)$ | `\p{name}` と同一のプロパティ名に対応する閉区間配列を昇順で返す |
| `Unicode.simple_case_folding` | `unit -> [(i64 * i64)]` | $O(t)$ | `CaseFolding.txt`（状態 C・S）の `(c, scf c)` ペア配列を昇順で返す |

`property_ranges` が受理する名前は一般カテゴリ短縮名 30 個、大分類 `L`・`LC`・`M`・`N`・`P`・`S`・`Z`・`C`、および二値プロパティ `Alphabetic`・`White_Space`・`Join_Control` です（`Uppercase_Letter` や `Script=Latin` などは `None`）。`property_ranges` と `simple_case_folding` は呼び出しごとにテーブルを展開して配列を確保するため、繰り返し参照する場合は結果を変数に保持してください。

```tsuzuri run=17.0.0%20Lu%20Nd%20So%20ranges%3D72%20pairs%3D1512
let ver = Unicode.version ()
let cats = $"{Unicode.category u8'A'} {Unicode.category u8'٣'} {Unicode.category u8'😀'}"
let digits = Unicode.property_ranges "Nd" |> Maybe.get
let pairs = Unicode.simple_case_folding ()
$"{ver} {cats} ranges={digits.length} pairs={pairs.length}"
```

### 正規化と正規化判定（UAX #15: 4 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Unicode.normalize` | `Unicode.NormalizationForm -> ref string -> string` | `string` を指定正規化形式へ変換 |
| `Unicode.normalize_utf8` | `Unicode.NormalizationForm -> ref utf8string -> utf8string` | `utf8string` を指定正規化形式へ変換 |
| `Unicode.is_normalized` | `Unicode.NormalizationForm -> ref string -> bool` | `string` がすでに指定正規化形式にあるか判定 |
| `Unicode.is_normalized_utf8` | `Unicode.NormalizationForm -> ref utf8string -> bool` | `utf8string` がすでに指定正規化形式にあるか判定 |

組み込みの文字列比較 `==` はコード単位列・バイト列を直接比較するため、視覚的に等価な結合文字列同士を比較する際はあらかじめ同じ正規化形式（通常は `Unicode.Nfc`）へ揃えます。

```tsuzuri run=nfd%3D2%20nfc%3D1%20nfkc%3Dfi1%20same%3Dtrue
let decomposed = "é" |> Unicode.normalize Unicode.Nfd
let composed = decomposed |> Unicode.normalize Unicode.Nfc
let compatible = Unicode.normalize_utf8 Unicode.Nfkc u8"ﬁ①"
let same = Unicode.is_normalized Unicode.Nfc (ref composed)
$"nfd={decomposed.length} nfc={composed.length} nfkc={compatible} same={same}"
```

### 書記素クラスタと単語境界（UAX #29: 8 関数）

境界配列を返す関数は、先頭オフセット `0` から文字列末尾の長さまでを昇順に格納した配列を返します（空文字列に対しても `[0]` を返します）。オフセットの単位は `string` 版が UTF-16 コード単位、`utf8string` 版がバイトです。

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Unicode.grapheme_boundaries` | `ref string -> [i64]` | 拡張書記素クラスタ境界のコード単位オフセット配列 |
| `Unicode.grapheme_boundaries_utf8` | `ref utf8string -> [i64]` | 拡張書記素クラスタ境界のバイトオフセット配列 |
| `Unicode.graphemes` | `ref string -> [string]` | 拡張書記素クラスタ単位に分割した部分文字列配列 |
| `Unicode.graphemes_utf8` | `ref utf8string -> [utf8string]` | 拡張書記素クラスタ単位に分割した UTF-8 配列 |
| `Unicode.word_boundaries` | `ref string -> [i64]` | UAX #29 既定単語境界のコード単位オフセット配列 |
| `Unicode.word_boundaries_utf8` | `ref utf8string -> [i64]` | UAX #29 既定単語境界のバイトオフセット配列 |
| `Unicode.words` | `ref string -> [string]` | 単語境界間のセグメント配列（空白や句読点区間も含む） |
| `Unicode.words_utf8` | `ref utf8string -> [utf8string]` | 単語境界間の UTF-8 セグメント配列 |

```tsuzuri run=clusters%3D3%20offsets%3D%5B0%2C%202%2C%2010%2C%2014%5D%20words%3D%5B%22It%27s%22%2C%20%22%20%22%2C%20%223.14%22%2C%20%22.%22%5D
let text = "e\u{301}👨‍👩‍👧🇯🇵"
let clusters = Unicode.graphemes (ref text)
let offsets = Unicode.grapheme_boundaries (ref text)
let segs = Unicode.words "It's 3.14."
$"clusters={clusters.length} offsets={offsets} words={segs}"
```

### 完全な大小文字変換とケースフォールディング（8 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Unicode.to_lower` | `ref string -> string` | 完全な小文字化（語末シグマ `Final_Sigma` 対応） |
| `Unicode.to_lower_utf8` | `ref utf8string -> utf8string` | `utf8string` の完全な小文字化 |
| `Unicode.to_upper` | `ref string -> string` | 完全な大文字化（`"straße"` → `"STRASSE"` など） |
| `Unicode.to_upper_utf8` | `ref utf8string -> utf8string` | `utf8string` の完全な大文字化 |
| `Unicode.to_title` | `ref string -> string` | UAX #29 の各単語先頭の cased 文字をタイトルケース化、残りを小文字化 |
| `Unicode.to_title_utf8` | `ref utf8string -> utf8string` | `utf8string` の単語単位タイトルケース化 |
| `Unicode.case_fold` | `ref string -> string` | 大小文字非依存比較向けの完全ケースフォールディング（状態 C・F） |
| `Unicode.case_fold_utf8` | `ref utf8string -> utf8string` | `utf8string` の完全ケースフォールディング |

トルコ語の `I` / `i` などロケール依存の条件付きマッピングは適用されません。ASCII 文字のみを高速に変換したい場合は `String.to_ascii_lower` / `Utf8String.to_ascii_lower` を使用します。

```tsuzuri run=STRASSE%20%CE%BF%CE%B4%CE%BF%CF%82%20Hello%20World%20strasse
let upper = Unicode.to_upper "straße"
let lower = Unicode.to_lower "ΟΔΟΣ"
let title = Unicode.to_title "hello wORLD"
let folded = Unicode.case_fold "Straße"
$"{upper} {lower} {title} {folded}"
```

## 計算量

入力のスカラー数を $n$、UCD テーブルの区間数を $t$、連続する結合文字の最大長を $k$ とすると、各操作の時間計算量は `category` が $O(\log t)$、`normalize` / `is_normalized` が $O(n \log t + k \log k)$、境界解析および大小文字変換が $O(n \log t)$ です。

## 関連項目

- [Regex](regex.md)
- [String](string.md)
- [Utf8String](utf8string.md)
- [Char と Utf8Char](char.md)
- [Text](text.md)
- [文字列](../../syntax/strings.md)
- [標準ライブラリの設計規約](../conventions.md)
