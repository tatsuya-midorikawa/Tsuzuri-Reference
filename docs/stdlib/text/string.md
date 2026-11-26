# String

`String` は UTF-16 コード単位列である組み込み型 `string` の検索・切り出し・連結・変換を提供する標準モジュールです。すべての長さと添字は Unicode スカラー値や書記素クラスタではなく、16 ビットの UTF-16 コード単位（`.length` と同一）を基準とします。

`string` 型自体のリテラル構文・所有権・サロゲート表現については[文字列](../../syntax/strings.md)を参照してください。`string` と `utf8string` を単一のインターフェースで扱いたい場合は[`Text`](text.md)型クラスを使用します。

## 要点

- 読み取り専用の関数は対象文字列を `ref string`（共有借用）として最後の引数に受け取り、元の値を消費せずに新しい所有文字列を返します。
- `find`・`split`・`starts_with`・`replace` などパターンや区切り文字を取る関数では、検索パターンや区切り文字が先頭引数、対象文字列 `text` が最終引数です。
- 一致なしや不正な切り出し範囲は `Maybe.None` を返し、範囲外の直接添字アクセス・`decode_at` の範囲外位置・負の `repeat` 回数はトラップします。
- 文字列検索はコード単位列の直接走査（最悪計算量 $O(n \cdot m)$）であり、正規表現や線形時間検索が必要な場面では[`Regex`](regex.md)を使用します。
- `string` の複製には `String.clone` ではなく組み込み関数 `clone_string` を使用します（または `Text.clone` を呼び出します）。

## 引数の順序

標準ライブラリ全体の設計規約（[標準ライブラリの設計規約](../conventions.md)）に従い、操作対象の文字列 `text`（または配列 `parts`）は常に最後の引数に配置されます。これによりパイプライン演算子 `|>` や関数合成 `>>` と自然に組み合わせられます。

- `String.find needle text`（`String.find text needle` ではありません）
- `String.slice first last text` / `String.sub first count text`
- `String.split separator text` / `String.join separator parts`
- `String.replace needle replacement text` / `String.repeat count text`

```tsuzuri run=word%3Dsuz%20loud%3DSUZ%20twice%3Dsuzsuz
let middle = String.sub 1 3 >> Maybe.default_value ""
let word = "Tsuzuri" |> middle
let loud = word |> String.to_ascii_upper
let twice = word |> String.repeat 2
$"word={word} loud={loud} twice={twice}"
```

## 長さ・要素取得・走査

| 関数 | シグネチャ | 失敗 | 説明 |
| --- | --- | --- | --- |
| `String.length` | `ref string -> i64` | なし | UTF-16 コード単位数を返す（`.length` と等価、$O(1)$） |
| `String.char_count` | `ref string -> i64` | なし | `char` 要素数（`length` と同値、スカラー数ではない、$O(1)$） |
| `String.chars` | `ref string -> [char]` | なし | 各コード単位を `char` に変換した新しい配列を返す（$O(n)$） |
| `String.decode_at` | `i64 -> ref string -> (char * i64)` | 範囲外でトラップ | 指定位置の `char` と次のオフセット `offset + 1` の組を返す（$O(1)$） |

`decode_at` はサロゲートペアを合成せず、常に 1 コード単位だけ進みます。補助平面の文字（例: `"😀"`）は 2 コード単位で構成されるため、`char_count` は `2`、`chars` は長さ 2 の配列になります。

```tsuzuri run=decoded%3D%5BA%5D1%20chars%3D%5B%27%5CuD83D%27%2C%20%27%5CuDE00%27%5D%20units%3D2%20last%3D66
let text = "AB"
let decoded = match String.decode_at 0 (ref text) with
    | (value, next) -> $"[{value}]{next}"
let chars = String.chars "😀"
let last = text[^0]
$"decoded={decoded} chars={chars} units={String.char_count "😀"} last={last}"
```

単一コード単位の添字 `text[i]` が返す型は `char` ではなく `i16u` です（`for unit in text` の反復変数も `i16u`）。Edition 2028 では末尾相対インデックス `text[^0]`（末尾のコード単位）も使用できます。一方、負の整数リテラル添字 `text[-1]` は末尾からの位置を意味せず、警告 `W1014` が報告されたうえで実行時にトラップします。

## 検索と比較

すべての関数が入力を共有借用で受け取ります。空文字列 `""` をパターンに渡した場合、`find "" text` は `Some 0`、`rfind "" text` は `Some text.length` を返し、`contains`・`starts_with`・`ends_with` は常に `true` を返します。

| 関数 | シグネチャ | 失敗 | 説明 |
| --- | --- | --- | --- |
| `String.find` | `ref string -> ref string -> Maybe<i64>` | 一致なしで `None` | 先頭から検索し、最初の一致の開始オフセットを返す |
| `String.rfind` | `ref string -> ref string -> Maybe<i64>` | 一致なしで `None` | 末尾から検索し、最後の一致の開始オフセットを返す |
| `String.contains` | `ref string -> ref string -> bool` | なし | `needle` が `text` に含まれるかを判定 |
| `String.starts_with` | `ref string -> ref string -> bool` | なし | `text` が `prefix` で始まるかを判定 |
| `String.ends_with` | `ref string -> ref string -> bool` | なし | `text` が `suffix` で終わるかを判定 |
| `String.compare` | `ref string -> ref string -> i64` | なし | 符号なし 16 ビットコード単位の辞書順で `-1`・`0`・`1` を返す（$O(\min(n, m))$） |

`String.compare` の比較順序は演算子 `<` と同一であり、ロケールには依存しません。

## 部分文字列の切り出し

`string` は配列スライス構文（`ref xs[a ..< b]`）の対象外であるため、部分文字列の取得には `String.slice` または `String.sub` を使用します。Edition 2028 の範囲構文では半開区間を `..<`、閉区間を `..=`（または境界付き `..`）で書き分けますが、`String.slice first last text` は全エディション共通で常に半開区間 `[first, last)` を切り出します。

| 関数 | シグネチャ | 失敗 | 説明 |
| --- | --- | --- | --- |
| `String.slice` | `i64 -> i64 -> ref string -> Maybe<string>` | 不正範囲で `None` | 半開区間 `[first, last)` のコード単位列を新しい文字列として返す |
| `String.sub` | `i64 -> i64 -> ref string -> Maybe<string>` | 不正範囲で `None` | `first` から `count` コード単位分の部分文字列を返す |

負のオフセット、`last < first`、`last > text.length`、および `first + count` の符号付き 64 ビット整数オーバーフローはいずれもトラップせず `None` となります。オフセットがサロゲートペアの途中を指していても、境界内であればそのまま切り出されます。

## 分割・連結・置換・反復

| 関数 | シグネチャ | 失敗 | 説明 |
| --- | --- | --- | --- |
| `String.concat` | `ref [string] -> string` | 長さ上限超過でトラップ | 配列内の文字列を区切りなしで連結（空配列は `""`） |
| `String.join` | `ref string -> ref [string] -> string` | 長さ上限超過でトラップ | `separator` を挟んで配列要素を連結（空配列は `""`） |
| `String.split` | `ref string -> ref string -> [string]` | なし | `separator` の出現箇所ごとに分割した配列を返す |
| `String.replace` | `ref string -> ref string -> ref string -> string` | 長さ上限超過でトラップ | 左から重ならない `needle` を `replacement` に置換 |
| `String.repeat` | `i64 -> ref string -> string` | 負数・上限超過でトラップ | `text` を `count` 回繰り返した文字列を返す（`0` 回は `""`） |

- **`split` の境界動作**: `separator` が非空のときは一致箇所ごとに分割し、先頭・末尾・連続する一致には空文字列 `""` が入ります（`String.split "," ""` は `[""]`）。`separator` が空文字列 `""` のときは各コード単位ごとに分割し、`"ab"` は `["a", "b"]`、`""` は `[]` になります。
- **`replace` の境界動作**: 左から非重複で一致箇所を置換し、置換後の文字列に対する再走査は行いません。空パターン `""` を指定した場合は各コード単位の前後（空文字列に対しては 1 回のみ）に `replacement` を挿入します。
- **確保の事前検証**: `join`・`concat`・`replace`・`repeat` は結果のコード単位数を事前に計算し、論理上限 $2^{53} - 1$ コード単位または `i64` の上限を超える場合は確保前にトラップします。

```tsuzuri run=index%3D3%20parts%3D%5B%22a%22%2C%20%22%22%2C%20%22b%22%5D%20piece%3DTsu%20dashed%3D-a-b-%20rep%3Dhahaha
let title = "Tsuzuri"
let index = String.find "zu" title |> Maybe.default_value (-1)
let parts = String.split "," "a,,b"
let piece = String.slice 0 3 title |> Maybe.default_value "none"
let dashed = String.replace "" "-" "ab"
$"index={index} parts={parts} piece={piece} dashed={dashed} rep={String.repeat 3 "ha"}"
```

## 空白除去と ASCII 大小文字変換

| 関数 | シグネチャ | 失敗 | 説明 |
| --- | --- | --- | --- |
| `String.trim` | `ref string -> string` | なし | 先頭および末尾の ASCII 空白文字を除去 |
| `String.trim_start` | `ref string -> string` | なし | 先頭の ASCII 空白文字を除去 |
| `String.trim_end` | `ref string -> string` | なし | 末尾の ASCII 空白文字を除去 |
| `String.to_ascii_lower` | `ref string -> string` | なし | ASCII 英大文字 `'A'`〜`'Z'` を小文字に変換 |
| `String.to_ascii_upper` | `ref string -> string` | なし | ASCII 英小文字 `'a'`〜`'z'` を大文字に変換 |

除去対象となる ASCII 空白文字はコード単位 `9`〜`13`（`\t`, `\n`, `\v`, `\f`, `\r`）および `32`（半角空白）のみであり、全角空白（U+3000）などの非 ASCII 空白は保持されます。Unicode 全域の大小文字変換や正規化には[`Unicode`](unicode.md)モジュールを使用します。

## コード単位配列・エンコーディング変換と複製

| 関数 | シグネチャ | 所有権 | 失敗 | 説明 |
| --- | --- | --- | --- | --- |
| `String.to_code_units` | `string -> [i16u]` | 入力をムーブ | なし | 内部コード単位列を配列へ変換（孤立サロゲートも保持） |
| `String.from_code_units` | `[i16u] -> string` | 入力をムーブ | 長さ $> 2^{53}-1$ でトラップ | コード単位配列から `string` を構築 |
| `clone_string` | `ref string -> string` | 共有借用 | なし | 文字列を複製して新しい所有値を返す（モジュール修飾なし、$O(n)$） |
| `String.from_utf8` | `ref utf8string -> string` | 共有借用 | 長さ上限超過でトラップ | 妥当な UTF-8 文字列を UTF-16 の `string` へ変換（$O(n)$） |
| `String.is_well_formed` | `ref string -> bool` | 共有借用 | なし | 孤立サロゲートを含まない整形式 UTF-16 であれば `true`（$O(n)$） |
| `String.to_well_formed` | `ref string -> string` | 共有借用 | なし | 孤立サロゲートを 1 単位ずつ `U+FFFD` に置換した文字列を返す（$O(n)$） |

既定の文字列レイアウト（`TSUZURI_STRINGS=utf16`）では、ヒープ確保された文字列に対する `to_code_units` および `from_code_units` はバッファの所有権をそのまま移譲し、要素コピーを行いません（定数領域のリテラルは事前にヒープへ複製されます）。コンパクト文字列モード（`TSUZURI_STRINGS=compact`、[コンパイラオプション](../../compiler/options.md)参照）で Latin-1（全コード単位 $\le \text{0xFF}$）として保持されている文字列については、1 バイト幅と 2 バイト幅の相互変換が $O(n)$ で行われますが、観測される値・孤立サロゲートの保持・トラップ条件は完全に同一です。

標準出力や `Utf8String.from_string` は整形式の UTF-16 を要求するため、孤立サロゲートを含む可能性がある文字列を出力・変換する前には `String.is_well_formed` で検査するか、`String.to_well_formed` で置換してください。

### SIMD による比較・UTF 変換の高速化

ネイティブターゲットでは、等値・順序比較および UTF-8 / UTF-16 間の変換・検証・整形式判定に 128 ビット SIMD（x86-64 の長い入力では実行時機能検出による AVX2 経路を含む）が自動的に利用されます。サロゲートや異なるバイト幅へ到達した時点で残りの区間を一度だけスカラー経路へ引き継ぐ設計であり、言語仕様上の順序・トラップ位置・アロケーション回数はスカラー実装と完全に一致します。WebAssembly ターゲットでは既定でスカラー経路が使われ、`--wasm-feature simd128` 指定時のみ 128 ビット SIMD 経路が有効になります。

## 計算量

以下の表は `std/String.tz` に記述された公開関数 21 個の最悪時間計算量です。`n` は対象文字列 `text` のコード単位数（`join`・`concat` では配列 `parts` の要素数）、`m` は検索パターンや区切り文字列のコード単位数、`k` は結果文字列のコード単位数を表します。

<!-- generated:complexity:String -->
| 関数 | 計算量 |
| --- | --- |
| `String.length` | $O(1)$ |
| `String.find` | $O(n \cdot m)$ |
| `String.rfind` | $O(n \cdot m)$ |
| `String.contains` | $O(n \cdot m)$ |
| `String.starts_with` | $O(m)$ |
| `String.ends_with` | $O(m)$ |
| `String.slice` | $O(k)$ |
| `String.sub` | $O(k)$ |
| `String.decode_at` | $O(1)$ |
| `String.char_count` | $O(1)$ |
| `String.chars` | $O(n)$ |
| `String.join` | $O(n + k)$ |
| `String.concat` | $O(n + k)$ |
| `String.split` | $O(n \cdot m)$ |
| `String.trim_start` | $O(n)$ |
| `String.trim_end` | $O(n)$ |
| `String.trim` | $O(n)$ |
| `String.to_ascii_lower` | $O(n)$ |
| `String.to_ascii_upper` | $O(n)$ |
| `String.repeat` | $O(k)$ |
| `String.replace` | $O(n \cdot m + k)$ |
<!-- /generated:complexity:String -->

## 関連項目

- [文字列](../../syntax/strings.md)
- [Utf8String](utf8string.md)
- [Char と Utf8Char](char.md)
- [Text](text.md)
- [Format](format.md)
- [Unicode](unicode.md)
- [Regex](regex.md)
- [標準ライブラリの設計規約](../conventions.md)
