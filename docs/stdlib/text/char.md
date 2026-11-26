# Char と Utf8Char

`Char` モジュールと `Utf8Char` モジュールは、Tsuzuri の 2 つの文字型である `char`（UTF-16 コード単位 1 個）と `utf8char`（Unicode スカラー値 1 個）に対する整数相互変換および ASCII 文字判定・変換を提供します。

`string` と `utf8string` の二層設計に対応し、`char` はサロゲートを含む任意の 16 ビットコード単位を保持できる一方、`utf8char` は補助平面の絵文字なども 1 文字として表現し、サロゲート領域を型レベルで排除します。リテラル構文の詳細は[リテラル](../../syntax/literals.md)および[文字列](../../syntax/strings.md)を参照してください。

## 要点

- `char`（`'A'`）は `0x0000`〜`0xFFFF` の全 65,536 通りを取る UTF-16 コード単位、`utf8char`（`u8'😀'`）はサロゲート領域 `U+D800`〜`U+DFFF` を除いた `U+0000`〜`U+10FFFF` の妥当な Unicode スカラー値です。
- 両型とも `Copy`・`Eq`・`Ord` を実装しており、関数へ値渡ししても元の束縛は消費されません。`Numeric` は実装しないため、`+` や `as` による直接の数値演算・キャストは行えず、専用の変換関数を通します。
- `Char` の 6 関数と `Utf8Char` の 6 関数はいずれも ASCII 範囲のみを判定・変換し、非 ASCII 文字は変更せずそのまま返します（計算量はすべて $O(1)$）。
- Unicode 一般カテゴリや非 ASCII 文字の大小文字変換・ケースフォールディングには[`Unicode`](unicode.md)モジュールを使用します。

## 2 つの文字型の比較

| 項目 | `char`（`Char` モジュール） | `utf8char`（`Utf8Char` モジュール） |
| --- | --- | --- |
| リテラル例 | `'A'`, `'あ'`, `'\uD800'` | `u8'A'`, `u8'あ'`, `u8'😀'` |
| 値域 | `0x0000`〜`0xFFFF`（サロゲート可） | `U+0000`〜`U+D7FF`, `U+E000`〜`U+10FFFF` |
| 補助平面文字（`U+10000`〜） | 1 値に収まらない（サロゲートペア 2 単位） | 1 つの `utf8char` 値として保持可能 |
| 対応する整数型 | `i16u`（全値で全単射） | `i32u`（不正値は `None` またはトラップ） |
| `Ord` の比較順序 | 符号なし 16 ビット整数順 | Unicode スカラー値（コードポイント）順 |
| `Display`（`to_string`） | 長さ 1 の `string`（孤立サロゲート出力時はトラップ） | BMP は長さ 1、補助平面は長さ 2 の `string` |
| `Parse.parse` の成功条件 | 入力 `string` が厳密に 1 コード単位のとき | 入力 `string` が厳密に 1 スカラー値のとき |

> [!WARNING]
> `string` の添字 `text[i]` は `i16u`、`utf8string` の添字 `bytes[i]` は `ubyte` を返します。文字型として取得するには `Char.of_u16 text[i]`（または `String.decode_at`）、UTF-8 では `Utf8String.decode_at` や `Utf8String.chars` を使用してください。

## 引数の順序

`Char` および `Utf8Char` の各関数はすべて単一の文字値または整数値を受け取る 1 引数関数であり、[標準ライブラリの設計規約](../conventions.md)における数値・文字プリミティブ操作としてそのままパイプライン `|>` や `Array.map` のコールバックに渡せます。なお、`Text` 型クラスには文字単位の取り出し操作が含まれないため、`Char` と `Utf8Char` を束ねる共通型クラスは定義されていません。

## `Char` モジュール

### コード単位との相互変換（組み込み関数）

| 関数 | シグネチャ | 失敗 | 計算量 | 説明 |
| --- | --- | --- | --- | --- |
| `Char.to_u16` | `char -> i16u` | なし | $O(1)$ | `char` の UTF-16 コード単位値を符号なし 16 ビット整数として取得 |
| `Char.of_u16` | `i16u -> char` | なし | $O(1)$ | 任意の `i16u` 値（サロゲート領域を含む）から `char` を生成 |

### ASCII 判定・変換（標準ライブラリ公開関数: 全 6 関数）

すべて `pure def` として定義されており、純粋関数型 `pure (char -> bool)` が要求される文脈にもそのまま渡せます。

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Char.is_ascii_digit` | `pure char -> bool` | `'0'`〜`'9'` のとき `true` |
| `Char.is_ascii_lower` | `pure char -> bool` | `'a'`〜`'z'` のとき `true` |
| `Char.is_ascii_upper` | `pure char -> bool` | `'A'`〜`'Z'` のとき `true` |
| `Char.is_ascii_alphabetic` | `pure char -> bool` | `'a'`〜`'z'` または `'A'`〜`'Z'` のとき `true` |
| `Char.to_ascii_upper` | `pure char -> char` | `'a'`〜`'z'` を `'A'`〜`'Z'` に変換し、他はそのまま返す |
| `Char.to_ascii_lower` | `pure char -> char` | `'A'`〜`'Z'` を `'a'`〜`'z'` に変換し、他はそのまま返す |

```tsuzuri run=code%3D65%20back%3DA%20surrogate%3D55296%20digit%3Dtrue%20alpha%3Dtrue%20upper%3DG%20kana%3D%E3%81%82
let code = Char.to_u16 'A'
let back = Char.of_u16 code
let surrogate = Char.to_u16 (Char.of_u16 0xD800i16u)
let kana = Char.of_u16 0x3042i16u
$"code={code} back={back} surrogate={surrogate} digit={Char.is_ascii_digit '7'} alpha={Char.is_ascii_alphabetic 'g'} upper={Char.to_ascii_upper 'g'} kana={Char.to_ascii_lower kana}"
```

孤立サロゲートの `char` を `to_string` で文字列化すること自体は成功しますが、その文字列を標準出力（UTF-8）へ書き出すとトラップするため、サロゲート値の検査・印字は `Char.to_u16` で数値化して行います。

## `Utf8Char` モジュール

### スカラー値との相互変換（組み込み関数）

| 関数 | シグネチャ | 失敗 | 計算量 | 説明 |
| --- | --- | --- | --- | --- |
| `Utf8Char.to_u32` | `utf8char -> i32u` | なし | $O(1)$ | Unicode スカラー値を符号なし 32 ビット整数として取得 |
| `Utf8Char.of_u32` | `i32u -> Maybe<utf8char>` | サロゲートまたは `> 0x10FFFF` で `None` | $O(1)$ | 整数値を検証して妥当な `utf8char` に変換 |
| `Utf8Char.of_u32_unchecked` | `i32u -> utf8char` | サロゲートまたは `> 0x10FFFF` でトラップ | $O(1)$ | 検証済みスカラー値からの直接変換（不正値は未定義動作ではなく安全にトラップ） |

`of_u32_unchecked` は境界検査を省略して不正なビット列を通す関数ではなく、`Maybe` のラップを介さずに `utf8char` を得る変換であり、不正値に対しては確実にトラップします。外部入力の変換には `Utf8Char.of_u32` を使用してください。

### ASCII 判定・変換（標準ライブラリ公開関数: 全 6 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Utf8Char.is_ascii_digit` | `utf8char -> bool` | `u8'0'`〜`u8'9'` のとき `true` |
| `Utf8Char.is_ascii_lower` | `utf8char -> bool` | `u8'a'`〜`u8'z'` のとき `true` |
| `Utf8Char.is_ascii_upper` | `utf8char -> bool` | `u8'A'`〜`u8'Z'` のとき `true` |
| `Utf8Char.is_ascii_alphabetic` | `utf8char -> bool` | `u8'a'`〜`u8'z'` または `u8'A'`〜`u8'Z'` のとき `true` |
| `Utf8Char.to_ascii_upper` | `utf8char -> utf8char` | `u8'a'`〜`u8'z'` を `u8'A'`〜`u8'Z'` に変換し、他はそのまま返す |
| `Utf8Char.to_ascii_lower` | `utf8char -> utf8char` | `u8'A'`〜`u8'Z'` を `u8'a'`〜`u8'z'` に変換し、他はそのまま返す |

```tsuzuri run=scalar%3D128512%20bad%3Dnone%20lower%3Dz%20upper%3DQ%20parsed%3D128512
let scalar = Utf8Char.to_u32 u8'😀'
let bad = match Utf8Char.of_u32 0xD800i32u with
    | Some _ -> "some"
    | None -> "none"
let lower = Utf8Char.to_ascii_lower u8'Z'
let upper = Utf8Char.to_ascii_upper u8'q'
let parsed: Maybe<utf8char> = Parse.parse "😀"
let parsed_code = match parsed with
    | Some c -> Utf8Char.to_u32 c
    | None -> 0i32u
$"scalar={scalar} bad={bad} lower={lower} upper={upper} parsed={parsed_code}"
```

`Parse.parse` を `char` または `utf8char` に対して呼び出す際は、戻り値の型から対象インスタンスを決定するため `let parsed: Maybe<utf8char> = ...` のように型注釈を添えます。空文字列、複数文字、孤立サロゲートのみの文字列を `utf8char` として解析した場合はトラップせず `None` を返します。

## 関連項目

- [リテラル](../../syntax/literals.md)
- [文字列](../../syntax/strings.md)
- [String](string.md)
- [Utf8String](utf8string.md)
- [Unicode](unicode.md)
- [標準ライブラリの設計規約](../conventions.md)
