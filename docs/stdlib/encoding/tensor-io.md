# TensorIO

`TensorIO` は、[`TensorCodec`](./tensor-codec.md) の変換をファイルにつなぐ opt-in 標準モジュールです。テンソルのファイル（`.npy`・`.npz`・Safetensors・CSV／TSV）を読み書きする関数と、大きなファイルを読み込まずに使う**読み取り専用のメモリーマップ**を提供します。関数はパッケージ権限 `fs` を要します。

ソースコード中に `TensorIO` が現れたときだけ、[`Tensor`](../numeric/tensor.md)・`TensorCodec`・`TensorElement` とともに読み込まれます。

## 要点

- `save_*`・`load_*` は `File.read_bytes`・`File.write_bytes` と `TensorCodec` を合わせたものです。`save_npy` が書くファイルは NumPy の `np.save` とバイト単位で同じで、`np.load` がそのまま読みます。
- `open_mmap_npy` はファイルをマップし、`view` が要素を**複写しない**窓（`Tensor.View`）を貸します。システムは触れたページだけを読みます。
- `MappedTensor` は破棄されるときに 1 回だけマップを解除します。窓は `MappedTensor` の借用なので、解除の後には使えません（コンパイル時に拒否されます）。
- 失敗は `union TensorIO.Error = Io of Os.Error | Codec of TensorCodec.Error | Unmappable of string` で返ります。
- WebAssembly はファイルをマップできません。`--wasm-host wasi` では `open_mmap_*` が `Io` エラーを返し、ファイルの読み書きは動きます。import のない既定の WebAssembly では、`TensorIO` は `File` と同じく `E2000` です（`TensorCodec` は使えます）。

## 読み書き

```tsuzuri run=saved%0A[2,%202]%20[1,%202,%203,%204]%0A["weights",%20"labels"]%20[7,%208]%0Anot%20found
def path_error :: ref TensorIO.Error -> string
fn path_error error =
    match error with
    | TensorIO.Io reason -> (match reason.kind with | Os.NotFound -> "not found" | _ -> "io")
    | _ -> Display.display error

let t = Tensor.of_array [2, 2] [1.0, 2.0, 3.0, 4.0]
let window = Tensor.view t
let! saved = TensorIO.save_npy "weights.npy" (ref window)
do! IO.writeln (match saved with
    | Result.Ok _ -> "saved"
    | Result.Error error -> Display.display error)

let! loaded = TensorIO.load_npy "weights.npy"
let weights: Result<Tensor<f64>, TensorIO.Error> = loaded
match weights with
| Result.Ok tensor ->
    let read = Tensor.view tensor
    do! IO.writeln $"{Tensor.shape read} {Tensor.as_array tensor}"
| Result.Error error -> do! IO.writeln (Display.display error)

// 要素型の違うテンソルは Raw にして 1 つのアーカイブへ。
let labels = Tensor.of_array [2] [7i64, 8i64]
let tensors = [("weights", TensorCodec.to_raw (ref window)), ("labels", TensorCodec.to_raw (Tensor.view labels))]
let! _packed = TensorIO.save_npz_compressed "model.npz" (ref tensors)
let! opened = TensorIO.load_npz "model.npz"
match opened with
| Result.Ok archive ->
    let found: Result<Tensor<i64>, TensorCodec.Error> = TensorCodec.archive_get "labels" archive
    do! IO.writeln $"{TensorCodec.archive_names archive} {Tensor.to_array (Result.get found)}"
| Result.Error error -> do! IO.writeln (Display.display error)

let! missing = TensorIO.load_npy_raw "missing.npy"
let! _a = File.remove "weights.npy"
let! _b = File.remove "model.npz"
match missing with
| Result.Ok _ -> IO.writeln "ok"
| Result.Error error -> IO.writeln (path_error error)
```

- 読む関数の要素型は結果の型から決まります（`let weights: Result<Tensor<f64>, TensorIO.Error> = loaded`）。ファイルの dtype が違えば `Codec (DtypeMismatch ...)` です。dtype を知らずに読むには `load_npy_raw` を使います。
- 書く関数は、**アクションを作る時点で**窓をバイト列に変換します。その後に元の配列を書き換えても、ファイルには届きません。
- IO の連鎖（`let!`）の中では一時値を借用できないので、窓や配列は先に `let` で束縛して `(ref window)` と渡します。
- `load_npz`・`load_safetensors` は [`TensorCodec.Archive`](./tensor-codec.md#npz-と-archive) を返します。テンソルは `TensorCodec.archive_get` で取り出します。
- `load_csv` は UTF-8 でないファイルを `Codec (CsvParseError (0, ...))` にします。

## 読み取り専用のメモリーマップ

`open_mmap_npy path` は `.npy` のファイル全体を読み取り専用でマップし（POSIX は `mmap`、Windows は `CreateFileMappingW`・`MapViewOfFile`）、要素を読まずにヘッダーを検査します。`view` は、マップしたメモリーの上の窓を返します。

```tsuzuri run=float64%20[2,%203]%2015%205%0Aexpected%20dtype%20float32,%20found%20float64%0A15
let t = Tensor.init [2, 3] (\i -> to_float i)
let window = Tensor.view t
let! _saved = TensorIO.save_npy "big.npy" (ref window)

let! opened = TensorIO.open_mmap_npy "big.npy"
match opened with
| Result.Ok mapped ->
    // 窓は mapped を借用する。要素は複写されない。
    let elements: Tensor.View<f64> = TensorIO.view (ref mapped)
    let total = Tensor.fold (\sum value -> sum + value) 0.0 (ref elements)
    do! IO.writeln $"{TensorCodec.dtype_name (TensorIO.mapped_dtype (ref mapped))} {TensorIO.mapped_shape (ref mapped)} {total} {deref (Tensor.at [1, 2] (ref elements))}"
| Result.Error error -> do! IO.writeln (Display.display error)

// dtype も確かめて開く。
let! typed = TensorIO.open_mmap_npy_as TensorCodec.F32 "big.npy"
match typed with
| Result.Ok _ -> do! IO.writeln "ok"
| Result.Error error -> do! IO.writeln (Display.display error)

// IO の連鎖の途中では、マップして関数を呼び、戻る前に解除する形を使う。
let! summed = TensorIO.with_mmap_npy "big.npy" (\mapped ->
    let elements: Tensor.View<f64> = TensorIO.view mapped
    Tensor.fold (\sum value -> sum + value) 0.0 (ref elements))
let! _removed = File.remove "big.npy"
match summed with
| Result.Ok total -> IO.writeln total
| Result.Error error -> IO.writeln (Display.display error)
```

### マップできるファイル

- 要素が **little-endian**（1 バイトの型はどちらでも）で、ファイルの中で**要素の境界に整列**していること。`np.save` と `TensorIO.save_npy` が書くファイルは 64 バイトに整列しています。big-endian のファイルと整列していないファイルは `Unmappable` です（`load_npy` なら読めます）。
- `bool` のファイルは、0・1 以外のバイトがないことを、開くときに全体を 1 回読んで確かめます（あれば `Unmappable`）。
- 列優先（Fortran 順）のファイルは、並べ替えずにそのまま窓になります。
- `open_mmap_safetensors name path` は、Safetensors のファイルの 1 つのテンソルを選びます。ヘッダー全体を `TensorCodec.decode_safetensors` と同じに検査します。

### 寿命と `Drop`

`MappedTensor` は不透明な非 Copy の値で、スコープを抜けるときにマップを解除します。`view` の結果は `MappedTensor` の借用なので、次のような使い方はコンパイルエラーです。

```text
def leak :: own TensorIO.MappedTensor -> Tensor.View<f64>
fn leak mapped = TensorIO.view (ref mapped)
// error[E1013]: cannot return a reference to a local value
```

- 窓が生きている間に `MappedTensor` を移動すると `E1014` です。
- `view` に求めた要素型がファイルの dtype と違うと、要素を読む前に**トラップ**します。`mapped_dtype` で確かめるか、`open_mmap_npy_as` で開いてください。
- `MappedTensor` は `Drop` の値なので、`let!` をまたいで持ち運べません（`E1005`）。開いた `let!` の直後の `match` の中で使うか、`with_mmap_npy` を使います。
- マップしている間にほかのプログラムがファイルを**切り詰める**と、欠けたページを読んだ時点でシステムがプログラムを止めます（POSIX の `mmap` の性質です。Windows はマップ中の切り詰めを拒否します）。書き込めるマップはありません。

## エラー

| case | 意味 |
| --- | --- |
| `Io error` | システムが拒否した（`Os.Error`。ファイルがない、権限がない、WebAssembly でマップしようとした、など） |
| `Codec error` | 内容がその形式の正しいファイルではない、または求めた dtype と違う（`TensorCodec.Error`） |
| `Unmappable reason` | 正しいファイルだが、そのままの場所では使えない（big-endian、整列していない要素、0・1 以外の `bool`） |

## 引数の順序

書く対象の窓・`Raw`・テンソルの並びと、読む対象の `MappedTensor` が最後の引数です。パス・オプション・メタデータはその前に置きます: `save_npy path view`、`save_csv options path view`、`save_safetensors_with metadata path tensors`、`open_mmap_npy_as dtype path`、`open_mmap_safetensors name path`、`with_mmap_npy path body`（[標準ライブラリの規約](../conventions.md)）。パスだけを取る関数に順序の選択はありません。

## 公開 API

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `TensorIO.save_npy` | `(TensorElement<'a>, Copy<'a>) => own string -> ref Tensor.View<'a> -> IO<Result<unit, Error>>` | 窓を `.npy` に書く |
| `TensorIO.load_npy` | `TensorElement<'a> => own string -> IO<Result<Tensor<'a>, Error>>` | `.npy` を読む |
| `TensorIO.save_npy_raw` | `own string -> ref TensorCodec.Raw -> IO<Result<unit, Error>>` | `Raw` を `.npy` に書く |
| `TensorIO.load_npy_raw` | `own string -> IO<Result<TensorCodec.Raw, Error>>` | `.npy` をファイルの dtype のまま読む |
| `TensorIO.save_npz` | `own string -> ref [(string * TensorCodec.Raw)] -> IO<Result<unit, Error>>` | 無圧縮の `.npz` に書く |
| `TensorIO.save_npz_compressed` | `own string -> ref [(string * TensorCodec.Raw)] -> IO<Result<unit, Error>>` | Deflate の `.npz` に書く |
| `TensorIO.load_npz` | `own string -> IO<Result<TensorCodec.Archive, Error>>` | `.npz` を読む |
| `TensorIO.save_safetensors` | `own string -> ref [(string * TensorCodec.Raw)] -> IO<Result<unit, Error>>` | Safetensors に書く |
| `TensorIO.save_safetensors_with` | `ref [(string * string)] -> own string -> ref [(string * TensorCodec.Raw)] -> IO<Result<unit, Error>>` | メタデータつきで Safetensors に書く |
| `TensorIO.load_safetensors` | `own string -> IO<Result<TensorCodec.Archive, Error>>` | Safetensors を読む |
| `TensorIO.save_csv` | `Display<'a> => own TensorCodec.CsvOptions -> own string -> ref Tensor.View<'a> -> IO<Result<unit, Error>>` | テキストの表に書く |
| `TensorIO.load_csv` | `Parse<'a> => own TensorCodec.CsvOptions -> own string -> IO<Result<Tensor<'a>, Error>>` | テキストの表を読む |
| `TensorIO.open_mmap_npy` | `own string -> IO<Result<MappedTensor, Error>>` | `.npy` を読み取り専用でマップする |
| `TensorIO.open_mmap_npy_as` | `own TensorCodec.Dtype -> own string -> IO<Result<MappedTensor, Error>>` | dtype も確かめてマップする |
| `TensorIO.open_mmap_safetensors` | `own string -> own string -> IO<Result<MappedTensor, Error>>` | Safetensors のテンソル（名前、パス）をマップする |
| `TensorIO.with_mmap_npy` | `Capture<'a> => own string -> own (ref MappedTensor -> 'a) -> IO<Result<'a, Error>>` | マップし、関数を呼び、解除する |
| `TensorIO.mapped_dtype` | `ref MappedTensor -> TensorCodec.Dtype` | マップしたファイルの dtype |
| `TensorIO.mapped_shape` | `ref { r } MappedTensor -> ref { r } [i64]` | マップしたファイルの形 |
| `TensorIO.view` | `TensorElement<'a> => ref { r } MappedTensor -> Tensor.View<'a> { r }` | 要素を複写しない窓 |

`view`・`mapped_dtype`・`mapped_shape` は権限を要しません。ほかの 16 個の関数の権限は `fs` です。
