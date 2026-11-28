# TensorCodec

`TensorCodec` は、テンソルをファイルの形式（NumPy の `.npy`・`.npz`、Safetensors、CSV／TSV）のバイト列やテキストと相互に変換する opt-in 標準モジュールです。ファイルには触れず、`[ubyte]` と `utf8string` だけを扱う純粋な変換なので、パッケージ権限は不要で、WebAssembly でも import を足さずに動きます。ファイルの読み書きと読み取り専用のメモリーマップは [`TensorIO`](./tensor-io.md) が担当します（[`Json`](./json.md) と `File` の関係と同じです）。

ソースコード中に `TensorCodec`（または型クラスの名前 `TensorElement`）が現れたときだけ、`Complex`・`Json`・[`Tensor`](../numeric/tensor.md)・`TensorElement` とともに読み込まれます。

## 要点

- `encode_npy` が書く `.npy` は、同じ配列に NumPy の `np.save` が書くファイルと**バイト単位で同じ**です。読む側は形式 1.0・2.0・3.0、little-endian・big-endian、行優先・列優先（Fortran 順）を受け付けます。
- `.npz` は無圧縮（`np.savez`）と Deflate 圧縮（`np.savez_compressed`）の両方を読み書きします。Deflate／Inflate と CRC-32 は Tsuzuri だけで実装してあり、`deflate`・`inflate`・`crc32` として単独でも使えます。
- 要素型は 14 個（`bool`、8〜64 bit の整数、`f16`・`f32`・`f64`、`Complex<f32>`・`Complex<f64>`）です。読む関数は**結果の型から要素型を決める**ので、型注釈を書きます。
- 壊れた・切り詰められた・悪意のある入力は必ず `Result.Error` になります。入力によってトラップせず、入力が正当化する以上のメモリーを確保しません。`.npy` の `object`（pickle）dtype は読まず、何も評価しません。
- 浮動小数点はビットをそのまま写すので、NaN の符号と payload、`-0.0`、非正規化数が変わりません。出力は target と最適化水準によらず同じです。

## 基本例

```tsuzuri run=160%20[2,%202]%20[1.5,%202.5,%203.5,%204.5]%0Aexpected%20dtype%20int32,%20found%20float64
let t = Tensor.of_array [2, 2] [1.5, 2.5, 3.5, 4.5]
let bytes = Result.get (TensorCodec.encode_npy (Tensor.view t))

// 読む側は、結果の型から要素型を決める。
let decoded: Result<Tensor<f64>, TensorCodec.Error> = TensorCodec.decode_npy bytes
let back = Result.get decoded
let window = Tensor.view back
do! IO.writeln $"{bytes.length} {Tensor.shape window} {Tensor.as_array back}"

// ファイルの dtype が違えば DtypeMismatch。
let wrong: Result<Tensor<i32>, TensorCodec.Error> = TensorCodec.decode_npy bytes
match wrong with
| Result.Ok _ -> IO.writeln "ok"
| Result.Error error -> IO.writeln (Display.display error)
```

## 要素型と `TensorElement`

`union TensorCodec.Dtype = Bool | I8 | I16 | I32 | I64 | U8 | U16 | U32 | U64 | F16 | F32 | F64 | Complex64 | Complex128`（`Eq`・`Display`）がファイルの要素型です。

| Tsuzuri の型 | `Dtype` | `dtype_name` | `.npy` の型文字列 | Safetensors |
| --- | --- | --- | --- | --- |
| `bool` | `Bool` | `bool` | `\|b1` | `BOOL` |
| `i8`／`i16`／`i32`／`i64` | `I8`〜`I64` | `int8`〜`int64` | `\|i1`、`<i2`、`<i4`、`<i8` | `I8`〜`I64` |
| `i8u`／`i16u`／`i32u`／`i64u` | `U8`〜`U64` | `uint8`〜`uint64` | `\|u1`、`<u2`、`<u4`、`<u8` | `U8`〜`U64` |
| `f16`／`f32`／`f64` | `F16`・`F32`・`F64` | `float16`〜`float64` | `<f2`、`<f4`、`<f8` | `F16`・`F32`・`F64` |
| `Complex<f32>`／`Complex<f64>` | `Complex64`・`Complex128` | `complex64`・`complex128` | `<c8`、`<c16` | （書けない） |

要素型ごとの入口（`encode_npy_f64` のような関数）はありません。型クラス `TensorElement`（`std/TensorElement.tt`。利用者のコードでは `TensorElement.TensorElement<'a>` と書きます）の instance が要素型を決めます。

```tsuzuri run=float32%2012
def describe :: (TensorElement.TensorElement<'a>, Copy<'a>) => ref Tensor.View<'a> -> string
fn describe view =
    let raw = TensorCodec.to_raw view
    $"{TensorCodec.dtype_name raw.dtype} {raw.data.length}"

let t = Tensor.of_array [3] [1.0f32, 2.0f32, 3.0f32]
describe (Tensor.view t)
```

`TensorElement` の instance は上の 14 個だけで、**利用者は足せません**。メソッド `element_type` の結果 `TensorCodec.ElementType<'a>` が不透明なレコードで、`TensorCodec` の外では作れないからです（`E1022`）。[`TensorIO.view`](./tensor-io.md) はマップしたメモリーをその要素型として読むので、ポインターを持つ型が要素型になると安全でなくなります。メソッドは `element_type`・`to_le_bytes`・`of_le_bytes` の 3 つで、ふつうは直接呼ばず、このモジュールの関数を使います。

### `Raw`: 要素型を消したテンソル

`record TensorCodec.Raw { dtype: Dtype, shape: [i64], data: [ubyte] }` は、dtype・形・行優先で little-endian の要素のバイト列です。dtype が実行時にしか分からないファイルを読むとき（`decode_npy_raw`）と、要素型の違うテンソルを 1 つのアーカイブにまとめるとき（`encode_npz`・`encode_safetensors` の入力）に使います。`data.length` が「形の積 × 要素の大きさ」に合わない `Raw` は、使う関数が `InvalidHeader` で拒否します。

```tsuzuri run=int16%20[2]%20[1,%200,%202,%201]%0A[1,%20258]
let t = Tensor.of_array [2] [1i16, 258i16]
let raw = TensorCodec.to_raw (Tensor.view t)
do! IO.writeln $"{TensorCodec.dtype_name raw.dtype} {raw.shape} {raw.data}"
let again: Result<Tensor<i16>, TensorCodec.Error> = TensorCodec.of_raw raw
IO.writeln (Tensor.to_array (Result.get again))
```

## `.npy`

- **書く**: `encode_npy`（窓から）と `encode_npy_raw`。形式 1.0、little-endian、行優先で、辞書の後ろに先頭の軸の大きさが伸びるための予備、64 バイトの倍数までの空白、改行が続きます（`np.save` と同じ）。連続でない窓（転置・反転・間引き）は行優先に詰め直します。
- **調べる**: `inspect_npy` は要素を読まずにヘッダーを検査し、`Header { dtype, shape, fortran_order, big_endian, data_offset }` を返します。
- **読む**: `decode_npy`（要素型は結果の型から）と `decode_npy_raw`（dtype はファイルから）。結果は常に行優先・little-endian です。big-endian は要素ごと（複素数は実部・虚部ごと）にバイトを入れ替え、列優先は並べ替えます。データの後ろに余ったバイトは無視します。

ヘッダーは、キー `descr`・`fortran_order`・`shape` がちょうど 1 回ずつ現れる辞書だけを受け付ける専用の解析器で読みます。`object`（pickle）・構造化 dtype・文字列・日時・その他の数値（`<f16`、`<c32` など）は `UnsupportedDtype` です。

```tsuzuri run=float64%20[2,%203]%20128%0Aint16%20[2]
let t = Tensor.init [2, 3] (\i -> to_float i)
let bytes = Result.get (TensorCodec.encode_npy (Tensor.view t))
match TensorCodec.inspect_npy bytes with
| Result.Ok header -> do! IO.writeln $"{TensorCodec.dtype_name header.dtype} {header.shape} {header.data_offset}"
| Result.Error error -> do! IO.writeln (Display.display error)

// dtype を知らずに読む。
let small = Tensor.of_array [2] [7i16, 9i16]
let unknown = Result.get (TensorCodec.encode_npy (Tensor.view small))
match TensorCodec.decode_npy_raw unknown with
| Result.Ok raw -> IO.writeln $"{TensorCodec.dtype_name raw.dtype} {raw.shape}"
| Result.Error error -> IO.writeln (Display.display error)
```

## `.npz` と `Archive`

`.npz` は、テンソル `x` を `x.npy` というファイルとして持つ ZIP アーカイブです。

- **書く**: `encode_npz`（無圧縮）、`encode_npz_compressed`（Deflate）、`encode_npz_with`（`NpzOptions { compress: bool, zip64: bool }`）。同じ入力からは常に同じバイト列で、時刻は 1980-01-01 00:00:00 の固定です（`np.savez` は現在時刻を書くので、アーカイブ全体は一致しません。中の `.npy` が一致します）。大きさや個数が従来の欄に収まらないときと `zip64: true` のときは ZIP64 の記録を書きます。空・重複・整形式でない名前は `InvalidArchive` です。
- **読む**: `decode_npz` はバイト列を**受け取って所有し**（`File.read_bytes` の結果を複写せずに渡せます）、中央ディレクトリー（ZIP64 を含む）を検査した `Archive` を返します。テンソルは名前で取り出し、そのときに展開して大きさと CRC-32 を確かめます。

| 関数 | 説明 |
| --- | --- |
| `archive_names` | ファイルの順の名前（`.npz` では `.npy` を除く） |
| `archive_get` | 結果の型の要素型でテンソルを取り出す。dtype が違えば `DtypeMismatch`、名前が無ければ `EntryNotFound` |
| `archive_raw` | dtype を問わず `Raw` として取り出す |
| `archive_inspect` | テンソルを作らずに dtype と形を返す。`data_offset` はアーカイブのバイト列の中での要素の位置（Deflate の要素は -1） |
| `archive_metadata` | Safetensors の `__metadata__`（`.npz` では空） |

```tsuzuri run=["weights",%20"labels"]%0A[1.5,%202.5]%20[7,%208,%209]%0Atrue
let weights = Tensor.of_array [2] [1.5, 2.5]
let labels = Tensor.of_array [3] [7i64, 8i64, 9i64]
let tensors = [("weights", TensorCodec.to_raw (Tensor.view weights)), ("labels", TensorCodec.to_raw (Tensor.view labels))]
let plain = Result.get (TensorCodec.encode_npz tensors)
let packed = Result.get (TensorCodec.encode_npz_compressed tensors)
let sizes = packed.length != plain.length

let archive = Result.get (TensorCodec.decode_npz packed)
do! IO.writeln (TensorCodec.archive_names archive)
let first: Result<Tensor<f64>, TensorCodec.Error> = TensorCodec.archive_get "weights" archive
let second: Result<Tensor<i64>, TensorCodec.Error> = TensorCodec.archive_get "labels" archive
do! IO.writeln $"{Tensor.to_array (Result.get first)} {Tensor.to_array (Result.get second)}"
IO.writeln sizes
```

暗号化・分割されたアーカイブ、範囲外や重なった位置、名前の重複、Deflate が広げられる倍率（1032 倍）を超える大きさの申告は `InvalidArchive`、展開の失敗と CRC-32 の不一致は `CorruptData`、Deflate 以外の圧縮は `UnsupportedCompression` です。

## Deflate・Inflate・CRC-32

生の DEFLATE（RFC 1951。zlib・gzip の包みなし。Python では `zlib.decompress(data, -15)` が読む形）です。

- `deflate` は 32,768 バイトの窓の貪欲な一致と、ブロックごとに「無圧縮・固定符号・動的符号」のうち最小の形を選びます。出力は入力だけで決まります。
- `inflate limit bytes` の `limit` は受け入れる出力の上限です。それを超える流れは `CorruptData` になり、出力の確保は上限（と入力の 1032 倍）を超えません。正しくない流れは `CorruptData`、途中で終わる流れは `TruncatedData` です。
- `crc32` は ZIP・PNG・zlib の CRC-32 です。

```tsuzuri run=true%20true%0A3421780262
let text = Utf8String.to_bytes (Utf8String.repeat 100 u8"tensor ")
let packed = TensorCodec.deflate text
let back = Result.get (TensorCodec.inflate text.length packed)
do! IO.writeln $"{packed.length < 40} {back == text}"
IO.writeln (TensorCodec.crc32 (Utf8String.to_bytes u8"123456789"))
```

## Safetensors

8 バイトのヘッダー長、JSON のヘッダー（`{"名前": {"dtype": "F32", "shape": [2, 3], "data_offsets": [0, 24]}, "__metadata__": {...}}`。100 MB まで）、バッファーの順のファイルです。

- `decode_safetensors` はバイト列を受け取って所有し、`.npz` と同じ `Archive` を返します。ヘッダーは完全に検査します: `{` で始まる JSON のオブジェクトであること、キーの重複がないこと、各テンソルの dtype・形・位置がそろって大きさが合うこと、テンソルがバッファーを**隙間も重なりもなく**覆うこと。
- `inspect_safetensors name bytes` は、バイト列を受け取らずに同じ検査をして、1 つのテンソルの dtype・形・位置を返します。
- `encode_safetensors`・`encode_safetensors_with metadata tensors` は、要素の大きい型から（同じ型の中では名前の UTF-8 のバイト順に）並べて各テンソルを整列させ、ヘッダーを空白で 8 バイトの倍数にします。
- 読み書きする dtype は `BOOL`・`U8`・`I8`・`I16`・`U16`・`F16`・`I32`・`U32`・`F32`・`F64`・`I64`・`U64` です。それ以外の名前（`BF16` など）は索引には残り、取り出すと `UnsupportedDtype` になります。複素数のテンソルは書けません。

```tsuzuri run=["w"]%20[("format",%20"pt")]%0Afloat32%20[2]%20true
let t = Tensor.of_array [2] [1.0f32, 2.0f32]
let file = Result.get (TensorCodec.encode_safetensors_with [("format", "pt")] [("w", TensorCodec.to_raw (Tensor.view t))])
let place = Result.get (TensorCodec.inspect_safetensors "w" file)
let aligned = place.data_offset % 8 == 0
let archive = Result.get (TensorCodec.decode_safetensors file)
do! IO.writeln $"{TensorCodec.archive_names archive} {TensorCodec.archive_metadata archive}"
IO.writeln $"{TensorCodec.dtype_name place.dtype} {place.shape} {aligned}"
```

## CSV・TSV

`record CsvOptions { delimiter: utf8string, skip_rows: i64, comment: utf8string }` が区切りを決めます。`csv ()` は `,` と `#` のコメント、`tsv ()` はタブと `#` です。`delimiter` が空なら、読むときは空白とタブの並び、書くときは空白 1 つを使います（NumPy の `loadtxt`・`savetxt` の既定）。

- `encode_csv options view` は、2 階の窓を 1 行 1 行に、1 階の窓を 1 行 1 要素に、0 階の窓を 1 行に書き、各行を LF で終えます（3 階以上は `UnsupportedRank`）。要素は `Display` の表記で、整数と `f32`・`f64` は `decode_csv` と `np.loadtxt` が同じビットへ読み戻します（`nan`・`inf`・`-inf` を含む）。
- `decode_csv options text` は、`Parse` が読める型（整数・浮動小数点・`bool`）の 2 階のテンソル（行, 列）を返します。行は LF で終わり（前の CR は無視）、先頭の `skip_rows` 行・コメント・空行を飛ばします。英字の大文字小文字は区別せず、`Infinity` も読みます。列の数が違う行・空のフィールド・値でないフィールドは `CsvParseError (行番号, 理由)` で、1 行もなければ形は `[0, 0]` です。

```tsuzuri run=1.5,-2%0A0.25,inf%0A[2,%203]%20[1,%202,%203,%204,%205,%206]%0Aline%202:%20expected%202%20fields,%20found%201
let t = Tensor.of_array [2, 2] [1.5, -2.0, 0.25, 1.0 / 0.0]
do! IO.write (Result.get (TensorCodec.encode_csv (TensorCodec.csv ()) (Tensor.view t)))

let text = u8"# x,y,z\n1,2,3\n\n4, 5, 6 # last\n"
let decoded: Result<Tensor<i64>, TensorCodec.Error> = TensorCodec.decode_csv (TensorCodec.csv ()) text
let table = Result.get decoded
let window = Tensor.view table
do! IO.writeln $"{Tensor.shape window} {Tensor.as_array table}"

let ragged: Result<Tensor<f64>, TensorCodec.Error> = TensorCodec.decode_csv (TensorCodec.tsv ()) u8"1\t2\n3\n"
match ragged with
| Result.Ok _ -> IO.writeln "ok"
| Result.Error error -> IO.writeln (Display.display error)
```

## エラー

`union TensorCodec.Error`（`Eq`・`Display`）:

| case | 意味 |
| --- | --- |
| `InvalidMagic` | 先頭がその形式のファイルではない |
| `UnsupportedVersion (major, minor)` | `.npy` の形式の版が 1.0・2.0・3.0 以外 |
| `InvalidHeader reason` | ヘッダーの内容が正しくない（`.npy` の辞書、Safetensors の JSON、食い違う `Raw`、書けない名前） |
| `DtypeMismatch (expected, found)` | 求めた要素型とファイルの dtype が違う |
| `UnsupportedDtype name` | 扱わない dtype（pickle・構造化・文字列・日時、Safetensors の `BF16`、複素数の書き出し） |
| `TruncatedData` | ヘッダーの言う長さより前にデータが終わる |
| `ShapeOverflow` | 形の積かバイト数が大きすぎる（2^62 以上） |
| `EntryNotFound name` | アーカイブにその名前がない |
| `UnsupportedCompression method` | `.npz` の要素が無圧縮でも Deflate でもない |
| `CsvParseError (line, reason)` | テキストの表のその行が読めない |
| `InvalidArchive reason` | ZIP の構造が正しくない、または書けない名前 |
| `CorruptData reason` | Deflate の流れが壊れている、CRC-32 が合わない、展開後が申告より大きい |
| `UnsupportedRank rank` | 3 階以上の窓は表の形にならない |

## 引数の順序

読む・変換する対象（窓、`Raw`、アーカイブ、バイト列、テキスト）が最後の引数です。名前・上限・オプションはその前に置きます: `archive_get name archive`、`inspect_safetensors name bytes`、`inflate limit bytes`、`encode_csv options view`、`decode_csv options text`、`encode_npz_with options tensors`、`encode_safetensors_with metadata tensors`（[標準ライブラリの規約](../conventions.md)）。

## 公開 API

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `TensorCodec.dtype_name` | `ref Dtype -> string` | NumPy の名前（`float64` など） |
| `TensorCodec.dtype_size` | `ref Dtype -> i64` | 1 要素のバイト数 |
| `TensorCodec.element_dtype` | `TensorElement<'a> => ref ['a] -> Dtype` | 配列の要素型の dtype（配列は読まない） |
| `TensorCodec.dtype_of` | `TensorElement<'a> => ref Tensor.View<'a> -> Dtype` | 窓の要素型の dtype |
| `TensorCodec.to_raw` | `(TensorElement<'a>, Copy<'a>) => ref Tensor.View<'a> -> Raw` | 窓を `Raw` へ複写 |
| `TensorCodec.of_raw` | `TensorElement<'a> => ref Raw -> Result<Tensor<'a>, Error>` | `Raw` からテンソルを作る |
| `TensorCodec.inspect_npy` | `ref [ubyte] -> Result<Header, Error>` | `.npy` のヘッダーを検査して返す |
| `TensorCodec.decode_npy` | `TensorElement<'a> => ref [ubyte] -> Result<Tensor<'a>, Error>` | `.npy` を結果の型の要素型で読む |
| `TensorCodec.decode_npy_raw` | `ref [ubyte] -> Result<Raw, Error>` | `.npy` をファイルの dtype のまま読む |
| `TensorCodec.encode_npy` | `(TensorElement<'a>, Copy<'a>) => ref Tensor.View<'a> -> Result<[ubyte], Error>` | 窓を `.npy` にする |
| `TensorCodec.encode_npy_raw` | `ref Raw -> Result<[ubyte], Error>` | `Raw` を `.npy` にする |
| `TensorCodec.crc32` | `ref [ubyte] -> i32u` | CRC-32 |
| `TensorCodec.inflate` | `own i64 -> ref [ubyte] -> Result<[ubyte], Error>` | 生の DEFLATE を、上限つきで展開 |
| `TensorCodec.deflate` | `ref [ubyte] -> [ubyte]` | 生の DEFLATE に圧縮 |
| `TensorCodec.decode_npz` | `own [ubyte] -> Result<Archive, Error>` | `.npz` の索引を読む |
| `TensorCodec.decode_safetensors` | `own [ubyte] -> Result<Archive, Error>` | Safetensors の索引を読む |
| `TensorCodec.archive_names` | `ref Archive -> [string]` | テンソルの名前 |
| `TensorCodec.archive_metadata` | `ref Archive -> [(string * string)]` | Safetensors の `__metadata__` |
| `TensorCodec.archive_inspect` | `ref string -> ref Archive -> Result<Header, Error>` | テンソルの dtype・形・位置 |
| `TensorCodec.archive_raw` | `ref string -> ref Archive -> Result<Raw, Error>` | テンソルを `Raw` で取り出す |
| `TensorCodec.archive_get` | `TensorElement<'a> => ref string -> ref Archive -> Result<Tensor<'a>, Error>` | テンソルを取り出す |
| `TensorCodec.inspect_safetensors` | `ref string -> ref [ubyte] -> Result<Header, Error>` | Safetensors の 1 つのテンソルの dtype・形・位置 |
| `TensorCodec.encode_safetensors_with` | `ref [(string * string)] -> ref [(string * Raw)] -> Result<[ubyte], Error>` | メタデータつきで Safetensors にする |
| `TensorCodec.encode_safetensors` | `ref [(string * Raw)] -> Result<[ubyte], Error>` | Safetensors にする |
| `TensorCodec.encode_npz_with` | `own NpzOptions -> ref [(string * Raw)] -> Result<[ubyte], Error>` | オプションつきで `.npz` にする |
| `TensorCodec.encode_npz` | `ref [(string * Raw)] -> Result<[ubyte], Error>` | 無圧縮の `.npz` にする |
| `TensorCodec.encode_npz_compressed` | `ref [(string * Raw)] -> Result<[ubyte], Error>` | Deflate の `.npz` にする |
| `TensorCodec.csv` | `unit -> CsvOptions` | `,` 区切り、`#` コメント |
| `TensorCodec.tsv` | `unit -> CsvOptions` | タブ区切り、`#` コメント |
| `TensorCodec.encode_csv` | `Display<'a> => own CsvOptions -> ref Tensor.View<'a> -> Result<utf8string, Error>` | 窓をテキストの表にする |
| `TensorCodec.decode_csv` | `Parse<'a> => own CsvOptions -> ref utf8string -> Result<Tensor<'a>, Error>` | テキストの表を 2 階のテンソルにする |

## 制限

- `.npy` の `object`（pickle）・構造化・文字列・日時の dtype、`f128` や 128 bit の整数は扱いません。
- 対応する target（x86-64、arm64、wasm32、wasm64）はすべて little-endian です。big-endian のファイルは読めますが、書くのは little-endian だけです。
- `encode_npz`・`decode_npz` はアーカイブ全体をメモリー上で扱います。メモリーに載せずに大きなファイルを読むには [`TensorIO.open_mmap_npy`](./tensor-io.md) を使います。
- Deflate は貪欲な一致で、zlib の既定（遅延一致）とは出力が違います（どちらの出力も互いに読めます）。
