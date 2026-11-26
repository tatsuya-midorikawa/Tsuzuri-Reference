# Debug

`Debug` は、開発・デバッグ中に式の値を確認するための軽量な診断出力モジュールです。`Display` 型クラスを実装する任意の値を文字列化して標準エラー出力（stderr）へ書き出すため、標準出力（stdout）へ流すプログラム本来の出力データを汚染せずに途中経過を観察できます。

`Debug.print` および `Debug.trace` を使用するパッケージには `stdio` 権限（capability）が必要です（[パッケージ管理と権限](../../modules/packages.md)）。

## 要点

- `Debug.print` は値を共有借用（`ref 'a`）して標準エラーへ1行出力し、値の所有権を呼び出し元に残します。
- `Debug.trace` は値を所有権ごと受け取り、標準エラーへ1行出力した後に同じ値をそのまま返すため、式やパイプラインの途中にそのまま挿入できます。
- ネイティブビルドでは常に標準エラー出力へ改行付きで書き出されます（Windows の GUI サブシステムで標準エラーハンドルが無い場合は `OutputDebugStringW` へフォールバックします）。
- WebAssembly ビルドでは既定で出力処理を行わず、`--debug-output` フラグを指定したときのみホスト関数 `tsuzuri_debug.write` をインポートして呼び出します。
- 内部組み込み関数 `Debug.__print_string` は非公開であり、ユーザーコードから呼び出すと `E1022` となります。

## 公開関数一覧

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Debug.print` | `Display<'a> => ref 'a -> unit` | 共有借用した値の `Display` 文字列に改行を添えて標準エラーへ出力する。値は消費されない |
| `Debug.trace` | `Display<'a> => own 'a -> 'a` | 値の `Display` 文字列を標準エラーへ出力した後、受け取った値そのものを返す |

どちらの関数も `Display.display` を使用して文字列へ変換します。`Display` インスタンスを持たない型を渡すと型クラス制約エラー（`E1005`）となります。

### 引数の順序

`Debug.print` と `Debug.trace` はともに1引数関数であり、引数順序の曖昧さはありません（[標準ライブラリの設計規約と引数の順序](../conventions.md)）。`x |> Debug.trace |> f` のようにパイプラインの途中段に挟んで値を確認できます。

## 基本的な使い方

### 変数を残したまま出力する（`Debug.print`）

非 `Copy` の文字列やコレクションを検査したあとも引き続き使用する場合は、`Debug.print` に共有参照を渡します。

```tsuzuri run=stdout-result
def main :: unit -> i32 = \() ->
    let label = "diagnostic-check"
    Debug.print (ref label)
    do! IO.writeln "stdout-result"
    0
```

このプログラムの標準出力には `stdout-result` のみが出力され、`diagnostic-check` は標準エラー出力へ分離されます。

### 式の途中で値を追跡する（`Debug.trace`）

部分式を変更せずに計算途中の値を確認したい場合は、`Debug.trace` で対象の部分式を包みます。

```tsuzuri run=150
def main :: unit -> i32 = \() ->
    let result = (100 + 20) |> Debug.trace |> (\n -> n + 30)
    do! IO.writeln result
    0
```

## WebAssembly での動作と `--debug-output`

WebAssembly ターゲット（`wasm32` / `wasm64`）では、既定で `Debug.print` と `Debug.trace` の出力書き込みは抑止されます（ただし引数式と `Display.display` の評価および一時バッファの解放は実行されます）。このとき余分なホストインポートは生成されません。

WASM 実行時にホスト側でデバッグ出力を受け取るには、ビルド時に `--debug-output` オプションを指定します（`build` および `run` サブコマンドのみ有効。`check`・`fmt`・`test` 等に指定すると `E2000`）。

```sh
tsuzuri build Kernel.tz --target wasm32 --debug-output -o debug.wasm
```

到達可能な `Debug` 呼び出しが存在する場合、モジュールは線形メモリ `memory` をエクスポートし、`tsuzuri_debug.write(pointer, length)`（WASM シグネチャ `(ptr, i64) -> ()`）をインポートします。

- ネイティブ実行とは異なり、WASM の `tsuzuri_debug.write` に渡される UTF-8 バイト列には**末尾の改行が含まれません**。
- `length` は `wasm32` / `wasm64` いずれでも `i64`（JavaScript では `BigInt`）として渡されます。`pointer` は `wasm32` で `Number`、`wasm64` で `BigInt` です。
- 渡されたスライスは関数から戻った時点で解放されるため、ホスト側はコールバック内で即座にバイト列を読み取る必要があります。

```javascript
let instance;
const imports = {
    tsuzuri_debug: {
        write(pointer, length) {
            const view = new Uint8Array(
                instance.exports.memory.buffer,
                pointer,
                Number(length),
            );
            console.error(new TextDecoder("utf-8", { fatal: true }).decode(view));
        },
    },
};
instance = new WebAssembly.Instance(module, imports);
```

## 注意事項とトラップ条件

- **純粋性検査との非両立**: `Debug.print` / `Debug.trace` はデバッグ出力作用（`debug` エフェクト）を持つため、`pure def` や [`Domain.run`](./domain.md) のクロージャ内からは呼び出せません。また、本番運用の構造化エラー出力には [`IO.write_errln`](../sys/io.md) を使用します。
- **並行出力の順序**: 複数の tzroutine や `Parallel.*` ワーカーから同時に呼び出した場合、出力順序や行単位のアトミック性は保証されません。
- **トラップ条件**:
  - 出力対象の `string` に孤立サロゲートが含まれており UTF-8 へ変換できない場合、`invalid Unicode encoding` でトラップします。
  - POSIX 環境で標準エラー（FD 2）が閉じているなど書き込みに失敗した場合、`debug output failed` でトラップします。なお Windows で標準エラーハンドルを持たないプロセス（`--subsystem windows` の GUI アプリケーション等）では、トラップせず `OutputDebugStringW` へ改行付き UTF-16 文字列を送出します。
- **内部関数の呼び出し禁止**: `Debug.__print_string` をユーザーコードから直接呼び出すとコンパイルエラー `E1022` が発生します。

## 関連項目

- [IO](../sys/io.md)
- [Domain](./domain.md)
- [リソース管理とアサーション](../../expressions/resources-and-assertions.md)
- [パッケージ管理と権限](../../modules/packages.md)
- [コンパイラオプション](../../compiler/options.md)
- [WebAssembly ターゲット](../../compiler/webassembly.md)
