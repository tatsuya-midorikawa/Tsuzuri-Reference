# Cbor

`Cbor` は、RFC 8949（Concise Binary Object Representation）に基づき、[`Json`](./json.md) と共通のデータモデル `Json.Value` および型クラス `Encode` / `Decode` を介してバイナリ形式の符号化・復号を行う opt-in 標準モジュールです。

ソースコード中に `Cbor` 識別子が現れたときのみ `Json` とともに読み込まれます。レコードや共用体に `deriving (Encode, Decode)`（および `@json` 属性）を一度定義すれば、追加の実装なしに JSON と CBOR の双方でシリアライズ・デシリアライズできます。パッケージ権限は不要で、ネイティブと WebAssembly の全ターゲットで同一のバイト列を生成します。

## 要点

- `Cbor.encode` / `Cbor.serialize` は **RFC 8949 §4.2.1 の決定論的符号化（Core Deterministic Encoding）**で出力するため、同じ論理値からは常に同一のバイト列が得られます。
- `Cbor.decode` / `Cbor.deserialize` は JSON データモデルに対応する定長 CBOR アイテムを最大 64 MiB・入れ子 128 段まで安全に復号します。
- 浮動小数点数は値を正確に保持できる最短精度（IEEE 754 半精度 `f16`・単精度 `f32`・倍精度 `f64`）へ自動短縮され、64 ビットを超える整数は bignum（タグ 2・3、最大 4096 桁）で表現されます。
- 失敗はすべてバイトオフセット付きの `Json.Error` として返され、不正入力や過大な長さプレフィックスに対してもトラップや過剰確保を起こしません。

## `Encode` / `Decode` の共通利用と基本例

`Cbor.serialize` と `Cbor.deserialize` は、内部で `Encode.encode` / `Decode.decode` と `Cbor.encode` / `Cbor.decode` を組み合わせます。

```tsuzuri run=true%0Aa26161016162820203%20f93e00%20c249010000000000000000
record Packet {
    @json "a" id: i64,
    @json "b" payload: [i64]
} deriving (Encode, Decode, Eq)

def to_hex :: ref [ubyte] -> string
fn to_hex bytes =
    let digits = "0123456789abcdef"
    let mut units = Vec.empty()
    for b in bytes do
        let hi = digits[(b >>> 4ubyte) as i64]
        let lo = digits[(b &&& 15ubyte) as i64]
        units = Vec.push_owned lo (Vec.push_owned hi units)
    String.from_code_units (Vec.to_array units)

def encode_json_hex :: ref utf8string -> string
fn encode_json_hex src =
    let val = Result.get (Json.parse src)
    let raw = Result.get (Cbor.encode val)
    to_hex raw

def main :: unit -> i32 = \() ->
    let pkt = Packet { id: 1, payload: [2, 3] }
    let bytes = Result.get (Cbor.serialize pkt)
    let restored: Result<Packet, Json.Error> = Cbor.deserialize bytes
    let ok = match restored with
        | Result.Ok p -> p == pkt
        | Result.Error _ -> false
    do! IO.writeln $"{ok}"

    let m = encode_json_hex u8"{\"b\": [2, 3], \"a\": 1}"
    let half = encode_json_hex u8"1.5"
    let big = encode_json_hex u8"18446744073709551616"
    do! IO.writeln $"{m} {half} {big}"
    0
```

上記の `{"b": [2, 3], "a": 1}` では、符号化済みキーバイト列の辞書順（`"a"` = `0x61 0x61` が `"b"` = `0x61 0x62` より先）に整列されて出力されるため、元のメンバー順にかかわらず `a26161016162820203` に一意化されます。

## データモデルと決定論的符号化の規則

### 符号化（`Cbor.encode`）

| `Json.Value` | CBOR 表現（RFC 8949 §4.2.1 / §4.2.2） |
| --- | --- |
| `Json.Null` | 単純値 `null`（`0xf6`） |
| `Json.Bool false` / `true` | 単純値 `false`（`0xf4`）/ `true`（`0xf5`） |
| 整数字句の `Json.Number` | `0..=2^64-1` は major type 0、`-2^64..=-1` は major type 1、それを超える 4096 桁以下の整数は bignum（タグ 2・3）。`-0` のみ半精度 `-0.0`（`0xf98000`） |
| 小数・指数字句の `Json.Number` | `f64` へ 1 回丸めた値を、値が完全一致する最短の IEEE 754 形式（`f16` `0xf9` / `f32` `0xfa` / `f64` `0xfb`）で出力（`f64` 範囲超過は `NumberRange`） |
| `Json.Text text` | 定長の UTF-8 テキスト文字列（major type 3）。孤立サロゲートを含む場合は `LoneSurrogate` |
| `Json.Items items` | 定長配列（major type 4） |
| `Json.Object members` | 定長マップ（major type 5）。キーを符号化バイト列の辞書順にソートし、重複キーは `DuplicateKey` で拒否 |

> **JSON 字句との違い**: CBOR は数値をバイナリ値として格納するため、`1.0` と `100e-2` のような表記上の違いは保持されません（`1.0` は半精度浮動小数点 `1.0` として符号化され、復号時は浮動小数点表現になります）。

### 復号（`Cbor.decode`）とエラー条件

`Cbor.decode` は JSON データモデルで表現できるアイテムのみを受理します（最短でない整数ヘッダや未ソートのマップキーは復号時には許容され、マップのキー順序は入力順のまま `Json.Object` に格納されます）。

```tsuzuri run={"a":1,"b":[2,3]}%20|%20json:%20unsupported%20byte%20string%20at%20byte%200%20|%20json:%20unexpected%20end%20of%20input%20at%20byte%201
def show_decoded :: own [ubyte] -> string
fn show_decoded raw =
    match Cbor.decode raw with
    | Result.Ok val ->
        let utf8 = Json.to_utf8string val
        String.from_utf8 utf8
    | Result.Error err -> $"{err}"

def main :: unit -> i32 = \() ->
    let valid: [ubyte] = [162ubyte, 97ubyte, 97ubyte, 1ubyte, 97ubyte, 98ubyte, 130ubyte, 2ubyte, 3ubyte]
    let byte_str: [ubyte] = [64ubyte]
    let truncated: [ubyte] = [130ubyte]
    do! IO.writeln $"{show_decoded valid} | {show_decoded byte_str} | {show_decoded truncated}"
    0
```

- **非対応アイテム（`Json.Unsupported`）**: バイト文字列（major type 2）、タグ 2・3 以外のタグ、テキスト文字列以外のマップキー、`undefined`（simple 23）その他の単純値、および不定長（indefinite-length、追加情報 31）アイテム。
- **構文・値エラー**: 予約済み追加情報（28〜30）や後続の余剰バイトは `Syntax`、不正な UTF-8 は `InvalidUtf8`、NaN・無限大は `NonFinite`、マップの重複キーは `DuplicateKey`、4096 桁を超える bignum は `NumberRange` となります。
- **資源保護上限**: 入力長の上限は 64 MiB（超過時は `TooLarge`、`offset == 0`）、配列・マップの最大入れ子深さは 128 段（超過時は `TooDeep`）です。また、配列やマップの宣言要素数が残り入力バイト数から見て明らかに到達不能な場合は、メモリ確保を行う前に即座に `UnexpectedEnd` を返します。

## 引数の順序

`Cbor` の公開関数 4 つはすべて単一引数（共有借用 `ref Json.Value`、`ref [ubyte]`、または `ref 'a`）を取るため、複数引数の順序選択はありません（[標準ライブラリの規約](../conventions.md)）。

## 公開 API

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Cbor.encode` | `ref Json.Value -> Result<[ubyte], Json.Error>` | `Json.Value` を RFC 8949 決定論的 CBOR バイト配列へ符号化 |
| `Cbor.decode` | `ref [ubyte] -> Result<Json.Value, Json.Error>` | CBOR バイト配列から 1 つのデータアイテムを `Json.Value` へ復号 |
| `Cbor.serialize` | `Encode<'a> => ref 'a -> Result<[ubyte], Json.Error>` | 任意の `Encode` 型を CBOR バイト配列へ一括変換 |
| `Cbor.deserialize` | `Decode<'a> => ref [ubyte] -> Result<'a, Json.Error>` | CBOR バイト配列を復号して任意の `Decode` 型へ一括変換 |

## 関連項目

- [Json](./json.md)
- [BigInt](../numeric/bigint.md)
- [Result](../core/result.md)
- [標準ライブラリの規約](../conventions.md)
- [型クラス](../../types/type-classes.md)
- [匿名共用体](../../types/anonymous-unions.md)
