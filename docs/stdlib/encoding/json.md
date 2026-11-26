# Json

`Json` は、RFC 8259 に準拠した厳密な JSON パーサ・決定論的シリアライザ・整形出力、木構造を構築しないストリーミング `Json.Reader` / `Json.Writer`、および組み込み型クラス `Encode` / `Decode` による Tsuzuri の型との相互変換を提供する opt-in 標準モジュールです。

ソースコード中に `Json`・`Encode`・`Decode` のいずれかの識別子が現れたときのみ読み込まれます。opt-in モジュールであるため、型や共用体ケースは常に `Json.Value`・`Json.Null`・`Json.Object`・`Json.Syntax` のようにモジュール名を前置して記述します（無修飾の `Null` などは解決されず `E1002` / `E1004` となります）。パッケージ権限は不要であり、ネイティブと WebAssembly の全ターゲットで同一のバイト列を生成します。

## 要点

- `Json.parse` は最大 64 MiB・入れ子 128 段までの UTF-8 JSON テキスト（`ref utf8string`）を厳密に解析し、重複キーや構文違反をバイト位置付きの `Json.Error` で返します。
- JSON の数値は元の字句を保持する `Json.Numeral` で表現されるため、$2^{53}$ を超える整数や高精度 10 進数も精度落ちなく往復します。
- `deriving (Encode, Decode)` と `@json "name"` 属性により、レコード・共用体・匿名共用体 `(A | B)`・標準コレクションをボイラープレートなしで相互変換できます。
- `Json.to_utf8string_pretty` / `Json.serialize_pretty` は `JSON.stringify(value, null, indent)` 互換のインデント出力を生成します。
- `Json.Reader`（プル型パーサ）と `Json.Writer`（逐次出力器）を使うと、`Json.Value` の木を確保せずにストリーム処理できます。

## データモデル（`Json.Value` と `Json.Numeral`）

```text
record Numeral { text: utf8string } deriving (Eq)
union Value = Null | Bool of bool | Number of Numeral | Text of string | Items of [Value] | Object of [(string * Value)] deriving (Eq)
union ErrorKind = Syntax | UnexpectedEnd | InvalidEscape | ControlCharacter | DuplicateKey of string | TooDeep | TooLarge
                | NonFinite | NumberRange | ExpectedType of string | MissingField of string | UnknownCase of string | LoneSurrogate
                | InvalidUtf8 | Unsupported of string deriving (Eq)
record Error { kind: ErrorKind, offset: i64 } deriving (Eq)
```

| JSON 要素 | `Json.Value` ケース | 表現の特徴 |
| --- | --- | --- |
| `null` | `Json.Null` | 単一ケース |
| `true` / `false` | `Json.Bool flag` | `bool` |
| 数値 | `Json.Number numeral` | `Numeral.text` に RFC 8259 の字句をそのまま保持（`Eq` は字句比較のため `1` と `1.0` は非等価） |
| 文字列 | `Json.Text text` | UTF-16 の `string`（`\uD800` のような孤立サロゲートも保持可能） |
| 配列 | `Json.Items items` | `[Json.Value]`（組み込み型名 `Array` との衝突を避けるため `Items`） |
| オブジェクト | `Json.Object members` | 入力順を保持する `[(string * Json.Value)]` |

## 解析・決定論的出力・整形出力

`Json.parse` は RFC 8259 の文法を厳密に検証します。先頭 BOM・コメント・末尾カンマ・先頭ゼロ（`01`）・`+1`・`.5`・`NaN`・`Infinity`・生制御文字（`0x00`〜`0x1F`）・エスケープ展開後の重複キーはすべて `Error` として拒否されます。

`Json.to_utf8string` は余分な空白を含まない決定論的な UTF-8 JSON を出力し、`Json.to_utf8string_pretty indent value` は 1 段あたり `indent` 個（1〜10 にクランプ、`1` 未満は空白なし）の空白で整形します。文字列エスケープは ECMAScript 2019 以降の `JSON.stringify` と一致し、孤立サロゲートは小文字の `\udxxx` として安全に出力されます。

```tsuzuri run=[1,2.50,{"a":[true,null]},"x😀"]%0A{%0A%20%20"a":%20[%0A%20%20%20%201,%0A%20%20%20%20[]%0A%20%20]%0A}%0Ajson:%20duplicate%20key%20"a"%20at%20byte%207
def main :: unit -> i32 = \() ->
    let src = u8"[1, 2.50, {\"a\": [true, null]}, \"x\\ud83d\\ude00\"]"
    let parsed = Result.get (Json.parse src)
    let compact = Json.to_utf8string parsed
    do! IO.writeln (String.from_utf8 compact)

    let nested = Result.get (Json.parse u8"{\"a\":[1,[]]}")
    let pretty = Json.to_utf8string_pretty 2 nested
    do! IO.writeln (String.from_utf8 pretty)

    let dup = Json.parse u8"{\"a\":1,\"\\u0061\":2}"
    do! IO.writeln (match dup with
        | Result.Ok _ -> "unexpected"
        | Result.Error err -> $"{err}")
    0
```

### 数値字句（`Json.Numeral`）の変換

`Json.numeral` は空白を含まない `utf8string` が RFC 8259 の数値文法を満たすときのみ複製して `Some` を返します（`Numeral { text: ... }` を不正な字句で直接構築して出力に渡すと `assert` トラップになります）。

- **`Json.to_i64`**: 小数点や指数部（`.`・`e`・`E`）を含む字句は `ExpectedType "integer"`、範囲外または 4096 バイト超の字句は `NumberRange` を返します（`-0` は `0` になります）。
- **`Json.to_f64`**: 字句から IEEE 754 `f64` へ最近接偶数丸めで 1 回だけ丸めます。無限大へオーバーフローする場合は `NumberRange` となります。

```tsuzuri run=9007199254740993%20NumberRange%20true
def main :: unit -> i32 = \() ->
    let exact = Maybe.get (Json.numeral u8"9007199254740993")
    let overflow = Maybe.get (Json.numeral u8"1e+400")
    let i = Result.default_value 0 (Json.to_i64 exact)
    let f_err = match Json.to_f64 overflow with
        | Result.Ok _ -> "ok"
        | Result.Error err -> if err.kind == Json.NumberRange then "NumberRange" else "other"
    let bad_num = Json.numeral u8"01"
    let rejected = Maybe.is_none bad_num
    do! IO.writeln $"{i} {f_err} {rejected}"
    0
```

## `Encode` / `Decode` と自動導出・`@json` 属性

組み込み型クラス `Encode<'a>` と `Decode<'a>` は、Tsuzuri の値と `Json.Value` を相互変換します（[`Cbor`](./cbor.md) とも共通です）。テキストとの一括変換には `Json.serialize`・`Json.serialize_pretty`・`Json.deserialize` を使用します。

| Tsuzuri の型 | `Encode` の出力形式 | `Decode` が受理する形式 |
| --- | --- | --- |
| `bool` | `true` / `false` | 真偽値 |
| `i8`〜`i128`、`i8u`〜`i128u` | 10 進整数 | 小数点・指数を含まない範囲内の整数 |
| `f16`・`f32`・`f64`・`f128`、`d32`・`d64`・`d128` | 最短 10 進表現（NaN・無限大は `NonFinite`） | 任意の JSON 数値（対象型へ 1 回丸め、無限大への溢れは `NumberRange`） |
| `string` / `utf8string` | JSON 文字列 | JSON 文字列（`utf8string` は孤立サロゲートで `LoneSurrogate`） |
| `Maybe<'a>` | `None` は `null`、`Some x` は `x` の結果 | `null` は `None`、それ以外は `Some` として復号 |
| `['a]`、`[\|'a\|]`、`Vec<'a>` | JSON 配列 | JSON 配列 |
| 2〜4 要素タプル | 固定長の JSON 配列 | 同じ要素数の JSON 配列（不一致時は `ExpectedType "array of N"`） |
| `Set<'k>`、`HashSet<'k>` | JSON 配列（`Set` は昇順） | 重複のない JSON 配列（重複要素は `DuplicateKey`） |
| `Map<'k, 'v>`、`HashMap<'k, 'v>` | 全キーが文字列になる場合はオブジェクト（空は `{}`）、それ以外は `[[k, v], ...]` | オブジェクトまたは `[[k, v], ...]`（重複キーは `DuplicateKey`） |
| `deriving` レコード | 宣言順フィールドのオブジェクト | オブジェクト（未知キーは無視、欠落キーは `null` として復号を試み失敗なら `MissingField`） |
| `deriving` 共用体 | ペイロードなしは `"Case"`、ありは `{"Case": payload}` | 同形式（未知ケースは `UnknownCase`） |
| 匿名共用体 `(A \| B)` | タグなしの要素値そのもの | JSON 値の種別で一意に定まる要素として復号（種別が重なる型は `E1025`） |

### `@json "name"` 属性とレコード・共用体の導出

`deriving (Encode, Decode)` を持つレコードのフィールドや共用体のケースに `@json "文字列"` を付けると、Tsuzuri 上の識別子を変えずに JSON 上のキー名やケースタグを変更できます（導出を持たない型への指定や、変更後の JSON 名の重複は `E1025` となります）。

```tsuzuri run=[{"created":{"user_id":7,"name":"Ann","email":null}},"Reset"]%20true%0Ajson:%20missing%20field%20"user_id"
record User {
    @json "user_id" id: i64,
    name: string,
    email: Maybe<string>
} deriving (Encode, Decode)

union Event =
    | @json "created" Created of User
    | Reset
    deriving (Encode, Decode)

def main :: unit -> i32 = \() ->
    let events = [Created (User { id: 7, name: "Ann", email: Maybe.None }), Reset]
    let encoded = Result.get (Json.serialize events)
    let roundtrip: Result<[Event], Json.Error> = Json.deserialize encoded
    let same = match roundtrip with
        | Result.Ok decoded ->
            let again = Result.get (Json.serialize decoded)
            again == encoded
        | Result.Error _ -> false
    do! IO.writeln $"{String.from_utf8 encoded} {same}"

    let missing: Result<User, Json.Error> = Json.deserialize u8"{\"id\":7,\"name\":\"Ann\"}"
    do! IO.writeln (match missing with
        | Result.Ok _ -> "unexpected"
        | Result.Error err -> $"{err}")
    0
```

### 匿名共用体の JSON 変換

[匿名共用体](../../types/anonymous-unions.md) `(i64 | string)` などはタグを付けずに直接ペイロードへ変換されます。復号時は JSON のトークン種別（`boolean`・`number`・`string`・`array`・`object`）から対象メンバーを静的に 1 つ選択します。`(i64 | f64)` のように複数のメンバーが同じ JSON 種別を読む型や、`Maybe`・名前付き共用体・手書き `Decode` 型を含む匿名共用体には `Decode` インスタンスが存在せず、使用箇所で `E1025`（`anonymous_union_decode_overlap`）が報告されます（`null` を許容したい場合は外側に `Maybe<(i64 | string)>` を被せます）。

```tsuzuri run={"id":42,"tags":"solo"}%20|%20num:42%20|%20str:item-9%20|%20json:%20expected%20number%20or%20string
record Entry { id: (i64 | string), tags: (string | [string]) } deriving (Encode, Decode)

def inspect_id :: ref utf8string -> string
fn inspect_id src =
    let decoded: Result<Entry, Json.Error> = Json.deserialize src
    match decoded with
    | Result.Ok entry ->
        match entry.id with
        | :? i64 as n -> $"num:{n}"
        | :? string as s -> $"str:{s}"
    | Result.Error err -> $"{err}"

def main :: unit -> i32 = \() ->
    let sample = Entry { id: 42, tags: "solo" }
    let raw = Result.get (Json.serialize sample)
    let text = String.from_utf8 raw
    let a = inspect_id u8"{\"id\":42,\"tags\":\"solo\"}"
    let b = inspect_id u8"{\"id\":\"item-9\",\"tags\":[\"a\",\"b\"]}"
    let c = inspect_id u8"{\"id\":true,\"tags\":[]}"
    do! IO.writeln $"{text} | {a} | {b} | {c}"
    0
```

## ストリーミング処理（`Json.Reader` と `Json.Writer`）

巨大な JSON から一部のフィールドだけを抽出する場合や、`Json.Value` の木を構築せずに出力したい場合は、`Json.Reader` と `Json.Writer` を使用します。

- **プル型パーサ `Json.Reader`**: `Json.reader text` で初期化し、`Json.next text reader` で `(Json.Event * Json.Reader)` を 1 トークンずつ進めます。文字列と数値は入力スライス範囲を表す `Json.Lexeme { start, finish, escaped }` として返るため不要なアロケーションが発生しません。エスケープを含まないキーの照合は `Json.token_matches` でゼロアロケーションのまま比較でき、文字列化が必要な箇所だけ `Json.token_text` や `Json.token_numeral` を呼びます。
- **逐次出力器 `Json.Writer`**: `Json.writer ()` で開始し、`open_object`・`write_key`・`write_*`・`close_object` などを連鎖させて最後に `Json.finish` で `utf8string` を取り出します。カンマやコロンは自動挿入され、対応しない閉じ括弧やキーなしオブジェクト値などの順序違反は `Syntax`、未完結での `finish` は `UnexpectedEnd`、129 段目の開始は `TooDeep` として検出されます。

```tsuzuri run=ids=2%20sum=6%20|%20{"name":"app","flags":[true,null]}
def main :: unit -> i32 = \() ->
    let doc = u8"{\"items\":[{\"id\":1},{\"id\":2,\"label\":\"x\"}],\"extra\":3}"
    let mut state = Json.reader doc
    let mut ids = 0
    let mut sum = 0
    let mut running = true
    while running do
        match state with
        | Result.Ok r ->
            match Json.next doc r with
            | Result.Ok (ev, r_next) ->
                match ev with
                | Json.KeyToken tok ->
                    if Json.token_matches "id" doc tok then ids = ids + 1
                | Json.NumberToken tok ->
                    let num = Result.get (Json.token_numeral doc tok)
                    sum = sum + Result.get (Json.to_i64 num)
                | Json.EndOfInput -> running = false
                | _ -> ()
                state = Result.Ok r_next
            | Result.Error err ->
                running = false
                state = Result.Error err
        | Result.Error _ -> running = false

    let key_name = "name"
    let val_app = "app"
    let key_flags = "flags"
    let written =
        Json.writer ()
        |> Json.open_object
        |> Result.bind (Json.write_key key_name)
        |> Result.bind (Json.write_text val_app)
        |> Result.bind (Json.write_key key_flags)
        |> Result.bind Json.open_array
        |> Result.bind (Json.write_bool true)
        |> Result.bind Json.write_null
        |> Result.bind Json.close_array
        |> Result.bind Json.close_object
        |> Result.bind Json.finish
        |> Result.get
    do! IO.writeln $"ids={ids} sum={sum} | {String.from_utf8 written}"
    0
```

## エラー種別と資源上限

- **入力サイズ上限**: 64 MiB（67,108,864 バイト）。超過時は先頭で `TooLarge`（`offset == 0`）を返します。
- **最大入れ子深さ**: 配列・オブジェクト合計 128 段。129 段目で `TooDeep` を返し、コールスタック枯渇を起こしません。
- **エラー位置 `offset`**: `parse` / `Reader` では問題箇所のバイトオフセット、`Writer` ではその時点までの出力バイト数、`encode` / `decode` / 数値変換では `-1` が入ります。

## 引数の順序

標準ライブラリの設計規約（[標準ライブラリの規約](../conventions.md)）に従い、変換・読み取り・書き込みの対象（`Value`・`Reader`・`Writer`・`Numeral`・`Lexeme`、および `serialize_pretty indent value` の対象値）はすべて**最後の引数**に置かれます。これにより `Json.writer () |> Json.open_object |> Result.bind (Json.write_key k)` のようなパイプライン合成が一貫して機能します。なお、`deriving (Encode, Decode)` の生成コードが内部プロトコルとして呼び出す補助関数（`decode_field`・`case_index` など）はコンパイラプロトコル免除の対象です。

## 公開 API

### 型と組み込み型クラス

```text
record Numeral { text: utf8string } deriving (Eq)
union Value = Null | Bool of bool | Number of Numeral | Text of string | Items of [Value] | Object of [(string * Value)] deriving (Eq)
union ErrorKind = Syntax | UnexpectedEnd | InvalidEscape | ControlCharacter | DuplicateKey of string | TooDeep | TooLarge
                | NonFinite | NumberRange | ExpectedType of string | MissingField of string | UnknownCase of string | LoneSurrogate
                | InvalidUtf8 | Unsupported of string deriving (Eq)
record Error { kind: ErrorKind, offset: i64 } deriving (Eq) // Display 実装あり
record Lexeme { start: i64, finish: i64, escaped: bool } deriving (Eq)
union Event = ObjectStart | ObjectEnd | ArrayStart | ArrayEnd | KeyToken of Lexeme | TextToken of Lexeme
            | NumberToken of Lexeme | BoolToken of bool | NullToken | EndOfInput deriving (Eq)
record Reader // 不透明（opaque）
record Writer // 不透明（opaque）

// 組み込み型クラス
Encode<'a> { encode :: ref 'a -> Result<Json.Value, Json.Error> }
Decode<'a> { decode :: ref Json.Value -> Result<'a, Json.Error> }
```

### 解析・出力・数値字句操作（11 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Json.parse` | `ref utf8string -> Result<Json.Value, Json.Error>` | RFC 8259 JSON テキストを解析（最大 64 MiB・128 段） |
| `Json.to_utf8string` | `ref Json.Value -> utf8string` | 空白なしの決定論的 JSON テキストへ直列化 |
| `Json.to_utf8string_pretty` | `own i64 -> ref Json.Value -> utf8string` | 1 段あたり `indent`（最大 10）空白で整形出力 |
| `Json.numeral` | `ref utf8string -> Maybe<Json.Numeral>` | JSON 数値文法を満たす字句を検証・複製して `Numeral` を構築 |
| `Json.to_i64` | `ref Json.Numeral -> Result<i64, Json.Error>` | 整数字句を `i64` へ変換 |
| `Json.to_f64` | `ref Json.Numeral -> Result<f64, Json.Error>` | 数値字句を最近接丸めで `f64` へ変換 |
| `Json.encode` | `Encode<'a> => ref 'a -> Result<Json.Value, Json.Error>` | 任意の `Encode` 型を `Json.Value` へ変換 |
| `Json.decode` | `Decode<'a> => ref Json.Value -> Result<'a, Json.Error>` | `Json.Value` を任意の `Decode` 型へ変換 |
| `Json.serialize` | `Encode<'a> => ref 'a -> Result<utf8string, Json.Error>` | 値を空白なし JSON テキストへ一括変換 |
| `Json.serialize_pretty` | `Encode<'a> => own i64 -> ref 'a -> Result<utf8string, Json.Error>` | 値を整形済み JSON テキストへ一括変換 |
| `Json.deserialize` | `Decode<'a> => ref utf8string -> Result<'a, Json.Error>` | JSON テキストを解析して目的の型へ一括変換 |

### ストリーミング `Json.Reader` / `Json.Writer`（17 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Json.reader` | `ref utf8string -> Result<Json.Reader, Json.Error>` | プル型パーサを初期化 |
| `Json.next` | `ref utf8string -> own Json.Reader -> Result<(Json.Event * Json.Reader), Json.Error>` | 次のイベントと進行後の `Reader` を取得 |
| `Json.token_text` | `ref utf8string -> ref Json.Lexeme -> Result<string, Json.Error>` | `KeyToken` / `TextToken` のエスケープを展開して `string` を取得 |
| `Json.token_matches` | `ref string -> ref utf8string -> ref Json.Lexeme -> bool` | 文字列トークンが指定文字列と一致するか判定（非エスケープ時は確保なし） |
| `Json.token_numeral` | `ref utf8string -> ref Json.Lexeme -> Result<Json.Numeral, Json.Error>` | `NumberToken` から `Numeral` を取得 |
| `Json.writer` | `own unit -> Json.Writer` | 空の逐次 JSON 出力器を作成 |
| `Json.open_object` | `own Json.Writer -> Result<Json.Writer, Json.Error>` | オブジェクト `{` を開始 |
| `Json.close_object` | `own Json.Writer -> Result<Json.Writer, Json.Error>` | 内側のオブジェクト `}` を終了 |
| `Json.open_array` | `own Json.Writer -> Result<Json.Writer, Json.Error>` | 配列 `[` を開始 |
| `Json.close_array` | `own Json.Writer -> Result<Json.Writer, Json.Error>` | 内側の配列 `]` を終了 |
| `Json.write_key` | `ref string -> own Json.Writer -> Result<Json.Writer, Json.Error>` | オブジェクトメンバーのキーと `:` を出力 |
| `Json.write_null` | `own Json.Writer -> Result<Json.Writer, Json.Error>` | `null` を出力 |
| `Json.write_bool` | `own bool -> own Json.Writer -> Result<Json.Writer, Json.Error>` | `true` または `false` を出力 |
| `Json.write_number` | `ref Json.Numeral -> own Json.Writer -> Result<Json.Writer, Json.Error>` | `Numeral` の数値字句を出力 |
| `Json.write_text` | `ref string -> own Json.Writer -> Result<Json.Writer, Json.Error>` | エスケープ済み JSON 文字列を出力 |
| `Json.write_json` | `ref Json.Value -> own Json.Writer -> Result<Json.Writer, Json.Error>` | `Json.Value` 全体を現在位置へ出力 |
| `Json.finish` | `own Json.Writer -> Result<utf8string, Json.Error>` | 最上位の値が 1 つ完結していれば JSON テキストを取り出す |

### 導出プロトコル補助関数（10 関数）

`deriving (Encode, Decode)` が生成するコードおよび手書きインスタンス（`fn rec` 指定）から利用される補助関数です。

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Json.begin_object` | `own i64 -> Result<Vec<(string * Json.Value)>, Json.Error>` | 指定容量のメンバーベクタを開始 |
| `Json.encode_field` | `Encode<'a> => own Result<Vec<(string * Json.Value)>, Json.Error> -> own string -> ref 'a -> Result<Vec<(string * Json.Value)>, Json.Error>` | フィールドをエンコードしてメンバー列へ追加 |
| `Json.end_object` | `own Result<Vec<(string * Json.Value)>, Json.Error> -> Result<Json.Value, Json.Error>` | メンバー列を `Json.Object` に確定 |
| `Json.encode_case` | `Encode<'a> => own string -> ref 'a -> Result<Json.Value, Json.Error>` | ペイロード付き共用体ケース `{"Case": payload}` を構築 |
| `Json.encode_tag` | `own string -> Result<Json.Value, Json.Error>` | ペイロードなし共用体ケース `"Case"` を構築 |
| `Json.expect_object` | `ref Json.Value -> Result<unit, Json.Error>` | 値が `Json.Object` でなければ `ExpectedType "object"` を返す |
| `Json.decode_field` | `Decode<'a> => ref Json.Value -> own string -> Result<'a, Json.Error>` | オブジェクトから指定キーを復号（未存在時は `null` 復号を試み失敗なら `MissingField`） |
| `Json.keep_error` | `own Maybe<Json.Error> -> own Result<'a, Json.Error> -> Maybe<Json.Error>` | 最初のエラーを保持しつつ `Result` を破棄 |
| `Json.case_index` | `ref Json.Value -> ref [string] -> ref [bool] -> Result<i64, Json.Error>` | 共用体ケース名配列とペイロード有無配列から該当ケース番号を特定 |
| `Json.decode_payload` | `Decode<'a> => ref Json.Value -> Result<'a, Json.Error>` | 単一メンバーオブジェクトのペイロード値を復号 |

## 関連項目

- [Cbor](./cbor.md)
- [Utf8String](../text/utf8string.md)
- [Format](../text/format.md)
- [Result](../core/result.md)
- [標準ライブラリの規約](../conventions.md)
- [型クラス](../../types/type-classes.md)
- [匿名共用体](../../types/anonymous-unions.md)
- [契約と属性](../../expressions/contracts-and-attributes.md)
