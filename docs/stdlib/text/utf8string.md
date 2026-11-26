# Utf8String

`Utf8String` は、常に妥当な UTF-8 バイト列であることが型レベルで保証された組み込み型 `utf8string` の検索・切り出し・連結・変換を提供する標準モジュールです。長さと添字の単位はバイトであり、関数名と引数順序は[`String`](string.md)と揃えられていますが、スライス境界の検証や空パターン分割では Unicode スカラー値の境界が守られます。

`string` と `utf8string` の選択指針は[文字列](../../syntax/strings.md)、両者を共通の関数名で扱う型クラスは[`Text`](text.md)を参照してください。

## 要点

- 対象文字列を受け取る引数はすべて `ref utf8string`（共有借用）で末尾に置かれ、検索パターンや区切り文字列が先頭引数となります。
- `slice` と `sub` は範囲検査に加え、始点と終点がともに Unicode スカラー境界上になければ（長さ 0 の空区間であっても）`Maybe.None` を返します。
- 空文字列 `u8""` を区切り・パターンとした `split` と `replace` は、バイト単位ではなく Unicode スカラー境界ごとに分割・挿入を行います。
- `from_bytes` は不正な UTF-8 シーケンスを検出すると入力バッファを解放して `None` を返すため、構築済みの `utf8string` が不正なバイト列を保持することはありません。
- 複製関数は `Utf8String.clone` です（`string` の `clone_string` とは異なりモジュール修飾が付きます）。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)に従い、操作対象の `utf8string`（または配列 `parts`）は常に最後の引数です。オフセットやバイト数はその前に配置されるため、パイプライン `|>` や関数合成 `>>` をそのまま利用できます。

- `Utf8String.find needle text` / `Utf8String.split separator text`
- `Utf8String.slice first last text` / `Utf8String.sub first count text`
- `Utf8String.replace needle replacement text` / `Utf8String.repeat count text`

```tsuzuri run=letter%3D%E3%81%84%20twice%3D%E3%81%84%E3%81%84%20bytes%3D6
let middle = Utf8String.sub 3 3 >> Maybe.default_value u8""
let letter = u8"あいう" |> middle
let twice = letter |> Utf8String.repeat 2
$"letter={letter} twice={twice} bytes={Utf8String.length (ref twice)}"
```

## 長さ・要素取得・走査

| 関数 | シグネチャ | 失敗 | 計算量 | 説明 |
| --- | --- | --- | --- | --- |
| `Utf8String.length` | `ref utf8string -> i64` | なし | $O(1)$ | UTF-8 バイト数を返す（`.length` と等価） |
| `Utf8String.char_count` | `ref utf8string -> i64` | なし | $O(n)$ | 先頭から走査して Unicode スカラー値の個数を返す |
| `Utf8String.chars` | `ref utf8string -> [utf8char]` | なし | $O(n)$ | 全スカラー値を順に格納した配列を返す |
| `Utf8String.decode_at` | `i64 -> ref utf8string -> (utf8char * i64)` | 非境界・範囲外でトラップ | $O(1)$ | 指定バイト位置のスカラー値と次スカラーの開始バイト位置を返す |

`decode_at` に負の位置、範囲外の位置、またはマルチバイト文字の後続バイト（continuation byte: 上位 2 ビットが `10`）のオフセットを渡すとトラップします。先頭 `0` から返却された次オフセットを順に辿る限り、常に妥当なスカラー境界上に留まります。

```tsuzuri run=mid%3Dnone%20parts%3D%5Bu8%22%E3%81%82%22%5D%20decoded%3D12354%403%20count%3D1
let bytes = u8"あ"
let mid_text = match Utf8String.slice 1 3 (ref bytes) with
    | Some _ -> "some"
    | None -> "none"
let parts = Utf8String.split u8"" bytes
let decoded = match Utf8String.decode_at 0 (ref bytes) with
    | (value, next) -> to_string (Utf8Char.to_u32 value) + "@" + to_string next
$"mid={mid_text} parts={parts} decoded={decoded} count={Utf8String.char_count bytes}"
```

直接添字 `bytes[index]` および `for byte in bytes` が返す要素型は `utf8char` ではなく 1 バイトの `ubyte` です。Edition 2028 では末尾バイトを `bytes[^0]` で参照でき、負の整数リテラル添字 `bytes[-1]` には警告 `W1014` が出力されます。

## 検索と比較

空パターン `u8""` の扱いは `String` と同一であり、`find u8"" text` は `Some 0`、`rfind u8"" text` は `Some text.length`、`contains`・`starts_with`・`ends_with` は `true` を返します。

| 関数 | シグネチャ | 失敗 | 計算量 | 説明 |
| --- | --- | --- | --- | --- |
| `Utf8String.find` | `ref utf8string -> ref utf8string -> Maybe<i64>` | 一致なしで `None` | $O(n \cdot m)$ | 先頭から検索し、最初の一致のバイトオフセットを返す |
| `Utf8String.rfind` | `ref utf8string -> ref utf8string -> Maybe<i64>` | 一致なしで `None` | $O(n \cdot m)$ | 末尾から検索し、最後の一致のバイトオフセットを返す |
| `Utf8String.contains` | `ref utf8string -> ref utf8string -> bool` | なし | $O(n \cdot m)$ | `needle` が `text` に含まれるかを判定 |
| `Utf8String.starts_with` | `ref utf8string -> ref utf8string -> bool` | なし | $O(m)$ | `text` が `prefix` で始まるかを判定 |
| `Utf8String.ends_with` | `ref utf8string -> ref utf8string -> bool` | なし | $O(m)$ | `text` が `suffix` で終わるかを判定 |
| `Utf8String.compare` | `ref utf8string -> ref utf8string -> i64` | なし | $O(\min(n, m))$ | 符号なしバイト順（Unicode スカラー順と一致）で `-1`・`0`・`1` を返す |

UTF-8 の符号なしバイト辞書順は Unicode コードポイント順と完全に一致します（補助平面文字と `U+FFFD` などの順序が逆転しうる UTF-16 コード単位順との相違点です）。

## 部分文字列の切り出し

`utf8string` には配列スライス構文（`ref xs[a ..< b]`）は適用できないため、`Utf8String.slice` または `Utf8String.sub` を用います。`slice first last text` は全エディション共通で半開区間 `[first, last)` を表します。

| 関数 | シグネチャ | 失敗 | 計算量 | 説明 |
| --- | --- | --- | --- | --- |
| `Utf8String.slice` | `i64 -> i64 -> ref utf8string -> Maybe<utf8string>` | 不正範囲・非境界で `None` | $O(k)$ | バイト区間 `[first, last)` を新しい `utf8string` として切り出す |
| `Utf8String.sub` | `i64 -> i64 -> ref utf8string -> Maybe<utf8string>` | 不正範囲・非境界で `None` | $O(k)$ | `first` から `count` バイトを切り出す |

負のオフセット、`last < first`、範囲外、加算オーバーフローに加え、`first` または `last` がマルチバイト文字の途中バイトを指している場合は（たとえ `first == last` の空区間であっても）安全に `None` を返します。

## 分割・連結・置換・反復

| 関数 | シグネチャ | 失敗 | 計算量 | 説明 |
| --- | --- | --- | --- | --- |
| `Utf8String.concat` | `ref [utf8string] -> utf8string` | 長さ上限超過でトラップ | $O(n + k)$ | 区切りなしで配列要素を連結（空配列は `u8""`） |
| `Utf8String.join` | `ref utf8string -> ref [utf8string] -> utf8string` | 長さ上限超過でトラップ | $O(n + k)$ | `separator` を挟んで配列要素を連結（空配列は `u8""`） |
| `Utf8String.split` | `ref utf8string -> ref utf8string -> [utf8string]` | なし | $O(n \cdot m)$ | `separator` の出現箇所ごとに分割した配列を返す |
| `Utf8String.replace` | `ref utf8string -> ref utf8string -> ref utf8string -> utf8string` | 長さ上限超過でトラップ | $O(n \cdot m + k)$ | 左から重ならない `needle` を `replacement` に置換 |
| `Utf8String.repeat` | `i64 -> ref utf8string -> utf8string` | 負数・上限超過でトラップ | $O(k)$ | `text` を `count` 回繰り返した文字列を返す（`0` 回は `u8""`） |

非空の `separator` や `needle` は妥当な UTF-8 同士の比較となるため、バイト列の一致位置は自動的にスカラー境界となります。一方、空の `u8""` を渡した `split` は各スカラーを 1 文字ずつの `utf8string` に分割し、`replace` は各スカラー境界と両端（空文字列に対しては 1 回のみ）に `replacement` を挿入します。結果バイト長は確保前に `i64` の上限に対して検査され、溢れる場合はトラップします。

## 空白除去と ASCII 大小文字変換

| 関数 | シグネチャ | 失敗 | 計算量 | 説明 |
| --- | --- | --- | --- | --- |
| `Utf8String.trim` | `ref utf8string -> utf8string` | なし | $O(n)$ | 先頭および末尾の ASCII 空白バイトを除去 |
| `Utf8String.trim_start` | `ref utf8string -> utf8string` | なし | $O(n)$ | 先頭の ASCII 空白バイトを除去 |
| `Utf8String.trim_end` | `ref utf8string -> utf8string` | なし | $O(n)$ | 末尾の ASCII 空白バイトを除去 |
| `Utf8String.to_ascii_lower` | `ref utf8string -> utf8string` | なし | $O(n)$ | ASCII 英大文字 `'A'`〜`'Z'` を小文字に変換 |
| `Utf8String.to_ascii_upper` | `ref utf8string -> utf8string` | なし | $O(n)$ | ASCII 英小文字 `'a'`〜`'z'` を大文字に変換 |

対象となる空白はバイト値 `9`〜`13` と `32` のみです。UTF-8 の自己同期性により、ASCII 範囲（`0x00`〜`0x7F`）のバイト操作がマルチバイト文字の後続バイト（`0x80`〜`0xBF`）を誤って書き換えることはありません。Unicode 全域の大小文字変換や正規化には[`Unicode`](unicode.md)の `_utf8` 系関数を使用します。

## バイト配列・`string` との相互変換と複製

| 関数 | シグネチャ | 所有権 | 失敗 | 説明 |
| --- | --- | --- | --- | --- |
| `Utf8String.to_bytes` | `utf8string -> [ubyte]` | 入力をムーブ | なし | 内部バッファを `[ubyte]` 配列へ移譲（ヒープ確保済みならゼロコピー） |
| `Utf8String.from_bytes` | `[ubyte] -> Maybe<utf8string>` | 入力をムーブ | 不正 UTF-8 で `None` | UTF-8 妥当性を検証し、成功時はバッファを移譲、失敗時は解放して `None` |
| `Utf8String.clone` | `ref utf8string -> utf8string` | 共有借用 | なし | バイト列を複製して新しい所有値を返す（$O(n)$） |
| `Utf8String.from_string` | `ref string -> utf8string` | 共有借用 | 孤立サロゲートでトラップ | UTF-16 の `string` を UTF-8 へ符号化（SIMD 対応、$O(n)$） |

`from_bytes` は入力配列の所有権を受け取るため、結果が `None` であった場合も元の配列を再利用することはできません。`from_string` に外部由来の `string` を渡す際は、あらかじめ `String.is_well_formed` で確認するか `String.to_well_formed` で孤立サロゲートを置換してください。

```tsuzuri run=bad%3Dnone%20back%3DA%20bytes%3D%5B65%5D
let bad_text = match Utf8String.from_bytes [255ubyte] with
    | Some _ -> "some"
    | None -> "none"
let raw = Utf8String.to_bytes u8"A"
let back_text = match Utf8String.from_bytes raw with
    | Some value -> to_string value
    | None -> "none"
$"bad={bad_text} back={back_text} bytes={Utf8String.to_bytes u8"A"}"
```

## 関連項目

- [文字列](../../syntax/strings.md)
- [String](string.md)
- [Char と Utf8Char](char.md)
- [Text](text.md)
- [Format](format.md)
- [Unicode](unicode.md)
- [Regex](regex.md)
- [標準ライブラリの設計規約](../conventions.md)
