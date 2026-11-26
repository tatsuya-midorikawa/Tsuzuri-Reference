# 文字列

Tsuzuri は用途とエンコーディング契約の異なる 2 種類の不変文字列型を備えています。既定の `string` は UTF-16 コード単位の列であり、`utf8string` は常に妥当性が保証された UTF-8 バイト列です。両者の間に暗黙の型変換は存在せず、文字型も同様に `char`（UTF-16 コード単位）と `utf8char`（Unicode スカラー値）の二系統に分かれています。

本ページでは、二系統の文字列モデル、エスケープシーケンスと改行規則、長さ・添字（Edition 2028 の `^k` を含む）・切り出し・比較・連結、所有権とバッファ再利用の仕組み、およびホスト連携における使い分けを解説します。標準ライブラリの個別関数一覧は [`String`](../stdlib/text/string.md) および [`Utf8String`](../stdlib/text/utf8string.md) を参照してください。

## 要点

- **二系統の不変文字列モデル**: `"..."` は `string`（16-bit UTF-16 コード単位列）、`u8"..."` は `utf8string`（妥当な UTF-8 バイト列）を生成します。
- **長さと添字の単位**: `.length`、添字 `text[i]`、`for` 反復の単位は、`string` では UTF-16 コード単位（`i16u`）、`utf8string` では UTF-8 バイト（`ubyte`）です。Edition 2028 では末尾相対添字 `text[^0]` も使用できます。
- **エスケープと生文字列の非採用**: 文字列中の改行は `\n` などのエスケープで記述します。生文字列リテラル（`r"..."` や `"""..."""`）は存在せず、生の改行を含めると `E0001` になります。
- **切り出し（スライス）の契約**: 部分文字列の取得には `String.slice` / `Utf8String.slice`（全エディション共通で半開区間 `[first, last)`、`Maybe` を返却）を用います。配列スライス構文 `ref xs[a ..< b]` をバイト列やコード単位列に適用したい場合は `to_code_units` / `to_bytes` で配列へ移します。
- **単一所有権と連結最適化**: 文字列は `Copy` ではなく所有権を移動します。コンパイラはリテラル連結の畳み込み、小規模連結のスタック配置、ヒープ左辺バッファの `realloc` 再利用を自動で行います。

## `string` と `utf8string` のモデル比較

`string` は [ECMA-262 の String 値モデル](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-ecmascript-language-types-string-type)に準拠した `0`〜`65535` の 16 ビットコード単位の不変列です。暗黙の Unicode 正規化は行わず、孤立サロゲートもデータとして欠損なく保持できます（論理最大長は $2^{53} - 1$ コード単位）。

`utf8string` は常に整形式（well-formed）の UTF-8 バイト列だけを値として保持します。リテラル検査でも実行時の `Utf8String.from_bytes` でも不正な UTF-8 シーケンスやサロゲートコードポイントは拒否されます。

| 操作・性質 | `string`（UTF-16 系） | `utf8string`（UTF-8 系） |
| --- | --- | --- |
| リテラル / 補間リテラル | `"こんにちは"` / `$"x={x}"` | `u8"こんにちは"` / `u8$"x={x}"` |
| 対応する 1 文字型 | `char`（`'A'`、1 コード単位） | `utf8char`（`u8'😀'`、1 Unicode スカラー） |
| `.length` の意味 | UTF-16 コード単位数（`"😀".length == 2`） | UTF-8 バイト数（`u8"😀".length == 4`） |
| 長さ取得関数 | `String.length :: ref string -> i64` | `Utf8String.length :: ref utf8string -> i64` |
| 添字 `text[i]` / `text[^0]` | `i16u` を返す（範囲外はトラップ） | `ubyte`（`i8u`）を返す（範囲外はトラップ） |
| `for unit in text do` | コード単位を `i16u` として先頭から列挙 | バイトを `ubyte` として先頭から列挙 |
| 連結演算子 `+` | 両辺を消費してコード単位列を連結 | 両辺を消費して UTF-8 バイト列を連結 |
| 等価・順序比較 (`==`, `<`) | 符号なし 16-bit コード単位の辞書順 | 符号なし 8-bit バイト順（スカラー値順と一致） |
| 明示的な複製関数 | `clone_string :: ref string -> string` | `Utf8String.clone :: ref utf8string -> utf8string` |
| 孤立サロゲートの保持 | 可（UTF-8 変換・標準出力時に検査） | 不可（型不変条件として排除） |

```tsuzuri run=units%3D3%20bytes%3D5%20first%3D65%20last_byte%3D128
let text = "A😀"
let utf8 = u8"A😀"
let mut unit_count = 0
for _u in text do
    unit_count = unit_count + 1
$"units={unit_count} bytes={utf8.length} first={text[0]} last_byte={utf8[^0]}"
```

書記素クラスタ（人間が画面上で 1 文字と認識する結合文字や絵文字シーケンス）単位での分割や文字数計算が必要な場合は、[`Unicode`](../stdlib/text/unicode.md) モジュールの `Unicode.graphemes` を使用します。

### 文字型 (`char` と `utf8char`) との対応

`text[i]` が返すのは数値型（`i16u` または `ubyte`）であり、`char` / `utf8char` ではありません。両方とも `Copy`・`Eq`・`Ord` を実装しますが数値型ではないため、整数との変換には専用関数を用います。

- `Char.of_u16 :: i16u -> char` / `Char.to_u16 :: char -> i16u`
- `String.decode_at :: i64 -> ref string -> (char * i64)`（常に 1 コード単位進む）
- `Utf8String.decode_at :: i64 -> ref utf8string -> (utf8char * i64)`（1 スカラー分のバイト数だけ進む。継続バイトの途中を指定するとトラップ）

詳細は[`Char` と `Utf8Char`](../stdlib/text/char.md)を参照してください。

## エスケープシーケンスと生文字列の扱い

### エスケープシーケンス一覧

文字列リテラル（`"..."`、`u8"..."`）内で使用できるエスケープシーケンスは以下のとおりです。

| エスケープ | 意味 | `string` (`"..."`) | `utf8string` (`u8"..."`) |
| --- | --- | --- | --- |
| `\"` | 二重引用符（`U+0022`） | 対応 | 対応 |
| `\\` | バックスラッシュ（`U+005C`） | 対応 | 対応 |
| `\n` | 改行 LF（`U+000A`） | 対応 | 対応 |
| `\r` | 復帰 CR（`U+000D`） | 対応 | 対応 |
| `\t` | 水平タブ（`U+0009`） | 対応 | 対応 |
| `\0` | NUL 文字（`U+0000`） | 対応（途中で終端しない） | 対応（途中で終端しない） |
| `\uXXXX` | 4 桁固定 16 進コード単位 | 対応（孤立サロゲートも記述可） | **非対応**（`E0001`） |
| `\u{H...}` | 波括弧付き Unicode コードポイント | 対応（`0`〜`10FFFF`、補助平面はサロゲートペア化） | 対応（1〜6 桁、サロゲート `D800`〜`DFFF` は `E0001`） |

単一引用符 `'` は文字列リテラル中ではエスケープせずそのまま `"it's"` と記述します（文字列内の `\'` は不正エスケープ `E0001` になります。逆に文字リテラル `'...'` 内では `\'` を使い、`"` はエスケープせず `'"'` と記述します）。

### 生文字列リテラルの非採用と複数行テキストの記述

Tsuzuri には Rust の `r#"..."#` や Python の `"""..."""` に相当する**生文字列リテラル（raw string literal）は存在しません**。また、文字列リテラルの中に直接改行を入れることはできず、字句エラー `E0001`（`raw_newline_in_string`）になります。

正規表現パターンや複数行テキストを記述する場合は、バックスラッシュを `\\`、改行を `\n` とエスケープするか、`+` 演算子（リテラル同士の `+` はコンパイル時に単一の静的文字列へ畳み込まれます）または `String.join` を用いて結合します。

```tsuzuri run=lines%3D2%20matched%3Dtrue
let message =
    "first line\n" +
    "second line"
let digits =
    match Regex.compile "\\d+" with
    | Result.Ok re -> Regex.is_match (ref re) "order-42"
    | Result.Error _ -> false
$"lines={(String.split "\n" message).length} matched={digits}"
```

## 長さ・添字・部分切り出し（スライス）

### 添字アクセスと Edition 2028 の末尾相対位置 `^k`

`text[index]` の `index` には `i8`〜`i128` および `i8u`〜`i128u` の任意の整数型を指定できます。Edition 2028 では角括弧内で末尾からのオフセットを表す `^k`（`text.length - 1 - k`）が使用でき、`text[^0]` が末尾のコード単位またはバイト、`text[^1]` が末尾から 2 番目の要素になります。

範囲外のインデックス（負数、`text.length` 以上、`i64` に収まらない値）は実行時に安全にトラップします。負の整数リテラルを直接書いた `text[-1]` は末尾アクセスにはならず必ずトラップするため、コンパイル時に警告 `W1014`（`negative_literal_index`）で `text[^0]` への修正が案内されます。

### 部分文字列の切り出しと配列スライスとの違い

`string` および `utf8string` には、配列用の借用スライス構文 `ref text[a ..< b]` は定義されていません（記述すると `E1005` になります）。部分文字列の取得には、新しい所有文字列を `Maybe` に包んで返す標準ライブラリの `slice` / `sub` 関数を使用します。

- `String.slice first last text :: i64 -> i64 -> ref string -> Maybe<string>`
- `String.sub first count text :: i64 -> i64 -> ref string -> Maybe<string>`
- `Utf8String.slice first last text :: i64 -> i64 -> ref utf8string -> Maybe<utf8string>`
- `Utf8String.sub first count text :: i64 -> i64 -> ref utf8string -> Maybe<utf8string>`

Edition 2028 で範囲構文の素の `..` が閉区間になった後も、関数 `String.slice` および `Utf8String.slice` は**全エディション共通で `last` を含まない半開区間 `[first, last)`** として動作します。標準ライブラリの引数順序規約に従い、対象となる文字列 `text` は常に最後の引数です。

`String.slice` はサロゲートペアの途中位置であっても有効なインデックス範囲内ならそのまま切り出しますが、`Utf8String.slice` / `Utf8String.sub` は始点と終点の双方が Unicode スカラー境界でなければ（空区間であっても）安全に `Maybe.None` を返します。

なお、文字列のバッファを `String.to_code_units` や `Utf8String.to_bytes` で配列へ移せば、Edition 2028 の半開スライス `ref units[1 ..< ^0]` や閉区間スライス `ref units[1 ..= 3]` でゼロコピーの部分参照を作ることができます。

```tsuzuri run=part%3DTsu%20utf8_mid%3Dnone%20window_len%3D5
let title = "Tsuzuri"
let part = Maybe.default_value "" (String.slice 0 3 title)
let utf8_mid =
    match Utf8String.slice 1 3 u8"あ" with
    | Maybe.Some _ -> "some"
    | Maybe.None -> "none"
let bytes = Utf8String.to_bytes u8"Tsuzuri"
let window = ref bytes[1 ..< ^0]
$"part={part} utf8_mid={utf8_mid} window_len={window.length}"
```

## 連結・辞書順比較・サロゲート変換

### 順序比較の注意点

等価比較（`==`、`!=`）はエンコーディング単位列の完全一致を判定します（`"😀" == "\uD83D\uDE00"` は `true` です）。ロケールや Unicode 正規化は行いません。

大小比較（`<`、`<=`、`>`、`>=`、および `compare`）は辞書順ですが、補助平面の文字（`U+10000` 以上）と BMP 後半の文字（`U+E000`〜`U+FFFF`）を比較した際に `string` と `utf8string` で順序が逆転する点に注意が必要です。

- `utf8string` のバイト順は Unicode スカラー値（コードポイント）の昇順と完全に一致します（`u8"\u{FFFD}" < u8"😀"` は `true`）。
- `string` の UTF-16 コード単位順では、`😀` の上位サロゲート `0xD83D` が `0xFFFD` より小さいため、`"\uFFFD" > "😀"` が `true` になります。

```tsuzuri run=equal%3Dtrue%20utf16_gt%3Dtrue%20utf8_lt%3Dtrue
let equal = "😀" == "\uD83D\uDE00"
let utf16_gt = "\uFFFD" > "😀"
let utf8_lt = u8"\u{FFFD}" < u8"😀"
$"equal={equal} utf16_gt={utf16_gt} utf8_lt={utf8_lt}"
```

### 相互変換と孤立サロゲートの扱い

| 関数 | シグネチャ | 契約と失敗時の挙動 |
| --- | --- | --- |
| `String.from_utf8` | `ref utf8string -> string` | UTF-8 を UTF-16 へ変換（入力は借用のみ） |
| `Utf8String.from_string` | `ref string -> utf8string` | UTF-16 を UTF-8 へ変換。**孤立サロゲートが含まれる場合はトラップ** |
| `String.is_well_formed` | `ref string -> bool` | 孤立サロゲートを含まない整形式 UTF-16 であれば `true` |
| `String.to_well_formed` | `ref string -> string` | 孤立サロゲートを 1 単位ずつ `U+FFFD` に置換した新しい `string` を返す |
| `String.to_code_units` / `from_code_units` | `own string -> [i16u]` / `own [i16u] -> string` | ヒープバッファのポインタをそのまま移譲（`compact` モードの Latin-1 文字列のみ拡縮変換） |
| `Utf8String.to_bytes` / `from_bytes` | `own utf8string -> [ubyte]` / `own [ubyte] -> Maybe<utf8string>` | バイト配列との間で所有権を移譲。`from_bytes` は不正 UTF-8 なら解放して `None` |

コンソールへの標準出力は UTF-8 ストリームへ書き出すため、外部入力由来の孤立サロゲートを含み得る `string` を出力・変換する前には `String.is_well_formed` で検査するか `String.to_well_formed` で置換します。

```tsuzuri run=well_formed%3Dfalse%20repaired%3Dtrue
let lone = "\uD800"
let well_formed = String.is_well_formed lone
let repaired = String.to_well_formed lone == "\uFFFD"
$"well_formed={well_formed} repaired={repaired}"
```

## 所有権・スタック最適化・バッファ再利用

文字列リテラル自体はバイナリの読み取り専用静的データ領域を指すため、リテラル評価時にヒープ確保やコピーは発生しません。変数に束縛した文字列は NUL 終端を持たない長さ付きスライス記述子として管理され、スコープを抜けた時点でヒープバッファなら自動的に解放されます。

値を複製せずに読み取る関数では共有借用（`ref string`、または Edition 2027 以降の無印引数 `string`）を受け取ります。明示的に独立したコピーを作る場合は `clone_string`（`string` 用）または `Utf8String.clone`（`utf8string` 用）を呼び出します。

### 連結演算子 `+` の最適化とバッファ再利用

連結演算子 `left + right` は両辺の所有権を消費して新しい文字列を返しますが、コンパイラとランタイムは以下の最適化を行います。

1. **リテラル畳み込みと確保省略**: リテラル同士の連結 `"a" + "b"` はコンパイル時に単一定数へ結合されます。また `(left + right).length` のように長さだけを参照する式では、オーバーフロー検査とオペランドの評価・解放順序を保ったまま結果バッファの確保を省略します。
2. **局所スタックバッファ**: 関数の外へ脱出しない小さな連結結果（UTF-16 で最大 128 コード単位、UTF-8 で最大 256 バイト、関数あたりの追加スタック予算合計 4 KiB 以内）は、ヒープアロケータを呼ばず関数フレーム上の 256 バイト領域へ直接書き込まれます（ネイティブ Windows の束縛初期化を除く）。
3. **左辺ヒープバッファの `realloc` 再利用**: 消費される左辺 `left` がヒープ上の所有バッファである場合、ランタイムは新規確保ではなく `realloc` によって左辺のバッファを伸長して右辺を追記します（静的領域やスタック領域の文字列は `realloc` に渡さず安全に新規確保します）。ただし文字列記述子は予約容量（capacity）フィールドを持たないため、ループ内で多数の断片を結合する処理には `String.concat` や `String.join` の一括確保が適しています。

また、オプトイン環境変数 `TSUZURI_STRINGS=compact` を指定してビルドすると、全コード単位が `0xFF` 以下の `string` が内部的に Latin-1（1 単位 1 バイト）で格納され、ASCII 主体のテキストのメモリ消費を半減できます（観測可能な文字列の意味論やホスト ABI は一切変化しません）。

## ホスト連携と使い分けの指針

| 用途・連携先 | 推奨する型・モジュール | 理由 |
| --- | --- | --- |
| コンソール表示・`Display`・文字列補間 | `string` | `Display.display` や `IO.writeln` の標準型が `string` であるため |
| JavaScript / WebAssembly バインディング | `string` | `--emit bindings-js` が UTF-16 ベースで JS 文字列と相互変換するため |
| Windows Win32 ワイド文字列 / C の `uint16_t*` | `string` + [`ZString`](../stdlib/text/zstring.md) | 内部 NUL 検査付きの NUL 終端 UTF-16 バッファとして安全に渡せるため |
| ファイル入出力・ネットワーク・HTTP / JSON バイト列 | `utf8string` | 不正バイト列を型レベルで排除でき、UTF-8 プロトコルと無変換で対応するため |
| `string` と `utf8string` の双方に対応する汎用処理 | [`Text`](../stdlib/text/text.md) 型クラス | `Text<'s> =>` 制約により単相化された直接呼び出しで共通化できるため |

## 関連項目

- [字句構造とブロック構文](./lexical-structure.md)
- [リテラル](./literals.md)
- [文字列補間と書式指定](./string-interpolation.md)
- [所有権とムーブ](../ownership/ownership-and-move.md)
- [スタックとヒープ・メモリレイアウト](../ownership/memory-layout.md)
- [`String`](../stdlib/text/string.md)
- [`Utf8String`](../stdlib/text/utf8string.md)
- [`Char` と `Utf8Char`](../stdlib/text/char.md)
- [`Text` 型クラス](../stdlib/text/text.md)
- [`Unicode`](../stdlib/text/unicode.md)
- [`Regex`](../stdlib/text/regex.md)
