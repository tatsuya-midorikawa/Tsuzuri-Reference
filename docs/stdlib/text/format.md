# Format

`Format` は、値の文字列化（`Display`）、文字列からの厳密な復元（`Parse`）、カスタム書式化（`Format` 型クラス）、および補間文字列の書式指定子 `[[fill]align][+][width][.precision][type]` を分解・適用する補助関数（`Format.parse`・`Format.pad`）を提供する標準モジュールです。

補間文字列リテラル `$"..."` の構文と組み込み型の書式指定ルールについては[文字列補間](../../syntax/string-interpolation.md)を参照してください。

## 要点

- `Display.display` は共有借用から、`to_string` は値を消費して `string` を生成します。浮動小数点数の文字列化は最近接偶数丸めによる最短往復表現であり、ロケールやホスト C ライブラリに依存せずネイティブと WebAssembly で完全に一致します。
- `Parse.parse` は入力文字列全体を厳密に検査して `Maybe<'a>` を返し、不正な入力でもトラップしません（呼び出し箇所では戻り値型の注釈が必要です）。
- `Format.parse` は書式指定文字列を `Maybe<Format.Spec>` レコードへ構文解析し、`Format.pad` は Unicode スカラー数に基づく幅揃えとパディングを行います。
- ユーザー定義のレコード・共用体には `instance Format<T>` を実装することで、`$"..."` の書式付きホール `{value:spec}` に対応させられます。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)に従い、`Format.parse` は解析対象の書式文字列 `ref string` を、`Format.pad` は書式仕様 `ref Spec` を先に受け取り整形対象の文字列 `own string` を最後の引数に取ります。

- `Format.parse spec_text`
- `Format.pad spec text`（`"ok" |> Format.pad (ref spec)` のようにパイプラインで渡せます）

## 値の文字列化（`Display` と `to_string`）

```text
Display.display : ref 'a -> string
to_string       : Display<'a> => 'a -> string
```

`Display.display` は対象を共有借用して新しい `string` を返し、`to_string` は値をムーブで受け取って文字列へ変換します（`string` に対する `to_string` は内部バッファの所有権をそのまま返すため追加コピーを行いません）。

プリミティブ数値型・`bool`・`unit`・`char`・`utf8char`・`string`・`utf8string` には組み込みの `Display` インスタンスが用意されており、配列・リスト・タプルは要素を再帰的に整形します。ユーザー定義型では `deriving (Display)` または `instance Display<T>` を定義します（未実装の型は `E1005`、組み込みインスタンスの重複実装は `E1016`）。

| 型 | `Display` の出力仕様 |
| --- | --- |
| 整数型 | 符号（負数のみ `-`）と 10 進数字列 |
| `f16` / `f32` / `f64` / `f128` | 同型へ正確に再解析できる最短桁列（正規化指数が $-6$ 未満または有効桁 $+6$ 以上で `1e+7` 形式の指数表記。負ゼロは `-0`、特殊値は `inf` / `-inf` / `nan`） |
| `d128`（10 進浮動小数点） | 正確な 10 進表記（末尾の冗長なゼロは省略: `0.10m` → `0.1`） |
| `bool` / `unit` | `true`・`false` / `()`（REPL や `main` の最終式が `unit` の場合は出力なし） |
| `char` / `utf8char` | 引用符なしの文字（補助平面の `utf8char` はサロゲートペア 2 コード単位の `string`） |
| `string` / `utf8string` | `string` はそのまま保持、`utf8string` は UTF-16 の `string` へ変換 |

## 文字列からの解析（`Parse`）

```text
Parse.parse : Parse<'a> => ref string -> Maybe<'a>
```

数値型・`bool`・`char`・`utf8char` に対して組み込みの `Parse` インスタンスが提供されており、ユーザー定義の具象型にも `instance Parse<T>` を実装できます（`deriving (Parse)` はありません）。戻り値の型変数が未確定のまま呼び出すと `E1015` となるため、`let n: Maybe<i64> = Parse.parse text` のように型注釈を明記します。

- 前後の空白・部分一致・空文字列・非 ASCII 数字・長さ 4,096 コード単位超の入力はいずれも `None` となります。
- 整数では先頭の `+` / `-`、小文字の `0x` / `0b` プレフィックス、数字間の `_`（`1_000`）を受理します（`1_`、`0x_1`、大文字 `0X` / `0B`、符号なし型の `-0`、表現範囲外の値は `None`）。
- 浮動小数点数では最近接偶数で 1 回だけ丸められ、オーバーフローして無限大になる有限リテラルは `None` となります（無限大・NaN は小文字の `inf` / `-inf` / `nan` のみ受理）。

```tsuzuri run=text%3D0.1%20back%3D0.1%20neg0%3D-0%20hex%3D255%20bad%3Dnone
let text = to_string 0.1
let back: Maybe<f64> = Parse.parse (ref text)
let value = match back with
    | Some number -> to_string number
    | None -> "none"
let hex: Maybe<i32> = Parse.parse "0xff"
let hex_text = match hex with
    | Some number -> to_string number
    | None -> "none"
let bad: Maybe<i32u> = Parse.parse "-1"
let bad_text = match bad with
    | Some _ -> "some"
    | None -> "none"
$"text={text} back={value} neg0={to_string (-0.0)} hex={hex_text} bad={bad_text}"
```

## 書式指定の型と公開関数（全 2 関数）

カスタムの `Format` インスタンス内で書式指定文字列 `[[fill]align][+][width][.precision][type]` を扱うため、以下の共用体・レコードと 2 つの公開関数が提供されています。

### データ型

```text
union Align = AlignAuto | AlignLeft | AlignCenter | AlignRight
union Kind  = KindPlain | KindLowerHex | KindUpperHex | KindOctal | KindBinary | KindExponent | KindFixed
record Spec { fill: string, align: Align, plus: bool, width: i64, precision: i64, kind: Kind }
```

- `Align`: 揃え指定なし（`AlignAuto`、パディング時は左寄せ扱い）、左寄せ `<`（`AlignLeft`）、中央寄せ `^`（`AlignCenter`）、右寄せ `>`（`AlignRight`）。`Eq` を実装します。
- `Kind`: 型指定文字なし（`KindPlain`）、および `x`・`X`・`o`・`b`・`e`・`f` に対応する各バリアント。`Eq` を実装します。
- `Spec`: `fill` は埋め文字 1 スカラー（省略時は `" "`）、`plus` は `+` 指定の有無、`width` は最小幅（省略時は `0`）、`precision` は精度（省略時は `-1`）。

### 公開関数一覧

| 関数 | シグネチャ | 失敗 | 計算量 | 説明 |
| --- | --- | --- | --- | --- |
| `Format.parse` | `ref string -> Maybe<Format.Spec>` | 文法違反で `None` | $O(m)$ | 書式文字列を構文解析して `Spec` レコードへ分解 |
| `Format.pad` | `ref Format.Spec -> own string -> string` | 上限超過でトラップ | $O(k)$ | 文字列長を Unicode スカラー数で測り、`spec.width` に満たなければ `spec.fill` でパディング |

`Format.parse` は次の入力に対して `None` を返します。
- 埋め文字が字句解析で禁止される `{`・`}`・`"`・`\`・`\r`・`\n`、または孤立サロゲートである場合
- `width` が `0` で始まる（`"08"` など）、`precision` が余分な先頭ゼロを持つ（`".05"` など）、または数値が `4096` を超える場合
- 書式文法に従わない余剰文字が残っている場合（なお `.2x` のような精度と型文字の意味的な組み合わせは `parse` では検査しません）

`Format.pad` は `spec.width` から `text` のスカラー数を引いた不足分を `spec.fill` で埋めます。中央寄せ（`AlignCenter`）で不足分が奇数のときは左側に `missing / 2` 個、右側に残りを配置します。すでに `spec.width` 以上の長さがある文字列は変更せずそのまま返します。

```tsuzuri run=%5B%2A%2A%2A%2Aok%5D%20width%3D6%20plus%3Dfalse%20precision%3D-1%20zero%3Dnone
let fixed = match Format.parse "*>6" with
    | Some parsed ->
        let padded = Format.pad (ref parsed) "ok"
        $"[{padded}] width={parsed.width} plus={parsed.plus} precision={parsed.precision}"
    | None -> "none"
let zero = match Format.parse "08" with
    | Some _ -> "some"
    | None -> "none"
$"{fixed} zero={zero}"
```

## カスタム `Format` 型クラス

```text
Format.format : Format<'a> => ref 'a -> ref string -> string
```

同一パッケージ内で宣言したレコードまたは共用体に `instance Format<T>` を実装すると、補間文字列の書式付きホール `$"{value:spec}"` がカスタマイズ可能になります（組み込み型や標準ライブラリ型への実装はオーファン規則 `E1016` で拒否されます）。

- ホールに幅・揃えのみが指定され、対象型に `Format` インスタンスがない場合、コンパイラは自動的に `Display.display` の結果へパディングを適用します。
- ホールに `+`・`.precision`・`type` 文字が含まれる場合は `Format` インスタンスが必須となり、未実装の場合は `E1005` となります。インスタンス内の実装では `Format.parse` で指定内容を取り出し、本文文字列を組み立てたうえで最後に `Format.pad` を呼ぶ構成が標準的です。

## 関連項目

- [文字列補間](../../syntax/string-interpolation.md)
- [文字列](../../syntax/strings.md)
- [String](string.md)
- [型クラス](../../types/type-classes.md)
- [Maybe](../core/maybe.md)
- [標準ライブラリの設計規約](../conventions.md)
