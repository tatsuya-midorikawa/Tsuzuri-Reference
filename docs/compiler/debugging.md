# デバッグ

`tsuzuri build -g`（`--debug-info`）は、関数・ソース行・ローカル変数・型の構造を表す DWARF デバッグ情報を生成します。LLDB に同梱の Python フォーマッタースクリプトを読み込むと、文字列・配列・連結リスト・`Vec`・共用体・匿名共用体・`Maybe`・`Result`・`Map`・`Set`・クロージャを C の低レベル構造体ではなく Tsuzuri 本来の値表記で観察できます。また、Windows で MSVC リンカーを使用する場合は CodeView と `.pdb` ファイルおよび Visual Studio 用の natvis 定義が出力され、`tsuzuri run` ではトラップ発生時のコールスタックが自動表示されます。

## 要点

- ソースレベルで変数の値まで観察するには `-g -O0`（既定の `--backend llvm`）でビルドします。macOS では実行ファイルの隣に `<output>.dwarf` が生成され、Linux では実行ファイル内に直接 DWARF が格納されます。
- LLDB では `command script import <配布物>/share/lldb/tsuzuri_lldb.py` で Tsuzuri 型フォーマッターを有効化できます（VS Code 拡張機能でのデバッグ起動時は自動適用されます）。
- ブレークポイント設定やコールスタック表示には、内部リンカーシンボルではなく `Main.show` のような Tsuzuri の関数名をそのまま使用できます。
- 単一のテストケースだけをデバッガーで追うには `tsuzuri test . --index N -g -o PATH` で専用ランナーバイナリをビルドし、引数 `0` を渡して起動します。
- `tsuzuri run` でプログラムがトラップすると、`E2005` 診断の直下にトラップ地点からエントリーポイントまでのバックトレースが出力されます（macOS / Linux ネイティブ）。

## デバッグ情報付きビルドと LLDB の起動

`-g`（または `--debug-info`）と `-O0` を指定してビルドします。

```sh
tsuzuri build . -g -O0 -o app
```

- **Linux**: DWARF セクションが実行ファイル `app` に含まれるため、そのまま `lldb app` で起動できます。
- **macOS**: `dsymutil` により `app.dwarf` が隣に生成されるため、実行前に `target symbols add` でシンボルを読み込みます。

```sh
lldb \
  -o "command script import ~/.local/share/tsuzuri/tsuzuri-0.1.0-darwin-arm64/share/lldb/tsuzuri_lldb.py" \
  -o "target symbols add app.dwarf" \
  app
```

毎回自動でフォーマッターを有効化したい場合は、`~/.lldbinit` に `command script import .../tsuzuri_lldb.py` を追記します（ソースツリーから利用する場合はリポジトリ内の `scripts/lldb/tsuzuri_lldb.py` を指定します）。なお、`--backend fast -g` でビルドした場合は関数名と行番号の DWARF のみが出力され、ブレークポイント停止やステップ実行・バックトレースは同様に機能しますが、ローカル変数と型の情報は含まれません。変数を観察する場合は既定の `--backend llvm` を使用してください。

## LLDB フォーマッターによる値の表示

`tsuzuri_lldb.py`（LLDB 15 以降対応）を読み込むと、`tsuzuri` 型カテゴリが登録されます。次のプログラムを `-g -O0` でビルドして `inspect_values` 内の最終行にブレークポイントを置いた例を示します。

```tsuzuri run=51
union Shape = Empty | Circle of f64 | Rect of f64 * f64
union Tree = Leaf | Node of Tree * i64 * Tree

def shape_score :: Shape -> i64 = \s ->
    match s with
    | Empty -> 0
    | Circle r -> r as i64
    | Rect (w, h) -> (w * h) as i64

def tree_val :: Tree -> i64 = \t ->
    match t with
    | Leaf -> 0
    | Node (_, v, _) -> v

def inspect_values :: i64 -> i64 = \input ->
    let text = "h\u{e9}llo"
    let letter = 'A'
    let shape = Rect (1.5, 2.0)
    let tree = Node (Leaf, input, Leaf)
    let outcome: Result<i64, string> = Result.Error "bad"
    let values = [1, 2, 3]
    let add = \offset -> input + offset
    let base = Array.sum values + shape_score shape + tree_val tree
    let bonus = match outcome with | Result.Ok n -> n | Result.Error msg -> msg.length
    base + add 0 - input + (if letter == 'A' then 0 else 1) + text.length - bonus

inspect_values 40
```

LLDB で `frame variable` を実行すると、各ローカル変数が次のように整形表示されます。

```text
(i64) input = 40
(string) text = "héllo"
(char) letter = 'A'
(Main.Shape) shape = Rect(1.5, 2)
(Main.Tree) tree = Node(Leaf, 40, Leaf)
(Result<i64, string>) outcome = Error("bad")
([i64]) values = length=3 {
  [0] = 1
  [1] = 2
  [2] = 3
}
(i64 -> i64) add = <fn Main.inspect_values.lambda@22:15>
```

### 型ごとの表示仕様と DWARF 内部表現

| Tsuzuri の型 | LLDB フォーマッターの表示 | DWARF 内部表現の補足 |
| --- | --- | --- |
| 整数・浮動小数点・10 進浮動小数点 | `(i64) x = 40` など（10 進浮動小数点は内部格納整数を表示） | 基本型名そのまま |
| `bool` / `unit` | `true`・`false` / `()` | `bool` / 空構造体 |
| `char` / `utf8char` | `'A'`、`u8'é'` | コード単位・スカラー値（`U+10FFFF` 超は `<invalid character N>`） |
| `string` / `utf8string` | `"héllo"`、`u8"abc"`（制御文字や孤立サロゲートは `\n`・`\u{d800}` にエスケープ、最大 1,024 単位で `...` 省略） | `TSUZURI_STRINGS=compact` の Latin-1 文字列（長さワードの bit 62 が `1`）も自動判別して同一表示 |
| 配列 `[T]` / スライス / `Vec<T>` | `length=3`（`Vec` は `length=1 capacity=4`）と要素 `[0]`… | 連続バッファを直接参照 |
| 連結リスト `[|T|]` | `length=N` と先頭からの要素 `[0]`… | チャンク連鎖（`head` → `next`）と先頭側空きスロットを辿って復元 |
| レコード / タプル | 宣言順のフィールド名と値 | アライメント最適化でメモリ上の配置順が変わっていても DWARF オフセットにより宣言順で表示 |
| タグ付き `union` / 再帰 `union` | `Green`、`Rect(1.5, 2)`、`Node(Leaf, 40, Leaf)`（最大ネスト 3 段） | `$tag` 列挙型と `$payload` 共用体 |
| ニッチ最適化された `union` | `Some("abc")`、`None` | タグを持たず `$niche`（文字列・配列は長さ `-1`、ネイティブ `ref` は `0`、関数値は記述子 `0`）で判別 |
| 匿名共用体 `(A \| B)` | `i64(42)`、`string("abc")` | `$tag` と `$payload` のメンバー名が要素型の表記になる |
| `Map<K, V>` / `Set<K>` | `size=N` と昇順要素 `[0]`… | チャンク配列を走査して表示 |
| 関数値（クロージャ） | `<fn Main.inspect_values.lambda@22:15>` | 静的記述子ポインタと捕捉環境ポインタの 2 ワード |

初期化前のスタック変数や破損ポインタに遭遇した場合でも、フォーマッターは例外で停止せず `<unreadable>`・`<invalid length N>`・`<invalid tag N>` として安全に表示します。

## 関数名とステップ実行の挙動

DWARF 内のサブルーチン名はリンカー用のマングル名ではなく、Tsuzuri ソース上の名前で記録されます。`breakpoint set -n Main.inspect_values` や `breakpoint set -f Main.tz -l 20` でそのまま停止できます。

| 対象 | DWARF 上の関数名 |
| --- | --- |
| モジュール関数 | `Main.inspect_values`（ジェネリック関数の全単相化実体も同一の `Array.sum` 名を共有するため、1 つのブレークポイントで全実体に停止可能） |
| ラムダ式 | `<外側関数>.lambda@<行>:<列>` |
| `tzroutine { ... }` 本体 | `<外側関数>.tzroutine@<行>:<列>` |
| `test "..."` 本体 | `<モジュール>.test@<行>:<列>` |
| `export def` ラッパー・入口 | `tz_<name>`・`main`・`tsuzuri_main`（コンパイラ生成の `artificial` 属性付き） |

ステップイン実行時、C ランタイム（tzroutine スケジューラや OS I/O）やコンパイラ自動生成の補助ラッパー（クロージャ適用アダプター・Drop グルー等）にはデバッグ情報を付与していないため、LLDB の既定動作で自動的にスキップされ、ユーザーコードの最初の本体行で正確に停止します。また、ネイティブ実行ファイル（`--emit exe`）にはエントリーポイント・`export def`・`Drop` から到達可能な関数のみが含まれるため、どこからも呼ばれない関数の調査には `--emit object` を使用します。

## 単体テストの個別デバッグ

失敗するテストケースをデバッガー上でステップ実行したい場合は、`tsuzuri test` に単一の `--index N`（`tsuzuri test --list` で確認した番号）と `-g -o PATH` を渡してデバッグ専用ランナーをビルドします。

```sh
tsuzuri test . --list
tsuzuri test . --index 0 -g -o target/debug-runner
lldb \
  -o "command script import ~/.local/share/tsuzuri/tsuzuri-0.1.0-darwin-arm64/share/lldb/tsuzuri_lldb.py" \
  -o "target symbols add target/debug-runner.dwarf" \
  -- target/debug-runner 0
```

ビルドされたランナーにコマンドライン引数 `0` を渡して起動すると、該当テストのみが同一プロセス内で実行され、`assert` 失敗やトラップ発生箇所でそのままデバッガーが停止します。VS Code 拡張機能の Testing ビューで各テスト横の **Debug** ボタンを押した場合も、同じ仕組みで一時ランナーが自動生成・起動されます。

## Windows における PDB と natvis

Windows 環境で外部の LLVM `clang` と MSVC リンカー（`link.exe`）を組み合わせて `-g` ビルドを行うと、DWARF に加えて CodeView デバッグ情報と `<output>.pdb` が出力され、配布物の `share/natvis/tsuzuri.natvis` が `/NATVIS` オプションで PDB 内に自動埋め込みされます。

- Visual Studio デバッガーや WinDbg で開くと、`string`・`utf8string`・`Vec`・`Map`・`Set`・`Maybe`・`Result` が Tsuzuri の値として整形表示されます（`TSUZURI_STRINGS=compact` の非 ASCII Latin-1 文字列のみ、natvis の仕様制約により UTF-8 として解釈されます）。
- `--emit object -g` で出力した `.obj` をホスト側でリンクする場合は、リンカー引数に `/DEBUG` と `/NATVIS:<配布物>/share/natvis/tsuzuri.natvis` を渡すことで同じ表示が得られます。
- 公式配布アーカイブ（`tsuzuri-clang`）および VS Code 拡張機能の同梱ツールチェーンは MinGW LLD でリンクするため、PDB ではなく DWARF + CodeLLDB（`tsuzuri_lldb.py`）の組み合わせでデバッグを行います。

## トラップのバックトレースとクラッシュレポート

macOS および Linux のネイティブ環境で `tsuzuri run`（`script`・`repl` を含む）を実行中にゼロ除算・配列境界外アクセス・`assert`・契約違反などでトラップすると、`E2005` 診断のソース引用直下にトラップ箇所（最内フレーム）から `main` までのコールスタックが出力されます。

```text
trap: integer division by zero at ./Main.tz:2:15
./Main.tz:2:15: error[E2005]: program terminated with signal: 5 (SIGTRAP); integer division, indexing, assert, a contract, or allocation may have trapped
  2 | def level3 :: i64 -> i64 = \x -> 100 / x
    |                                  ^
  at Main.level3
  at Main.level2
  at Main.level1
  at Main.main
```

- `-g` を併用して実行すると、呼び出し側フレームにも `(./Main.tz:5:15)` のようなソース行・列が付記されます。`--json` 指定時は診断オブジェクト末尾の `trap.frames` 配列に格納されます（最大 32 フレーム）。
- シンボル解決には `TSUZURI_LLVM_SYMBOLIZER`（未設定時は `PATH` 上の `llvm-symbolizer`）を使用します。ツールが見つからない場合でもエラーにはならず、テキスト出力では案内ノートを出し、`--json` ではリンク時アドレスのみを記録します。`-O3` ではインライン展開された中間関数はフレームを持たないため省略されます。

### 配布バイナリからのクラッシュレポート出力（`TSUZURI_TRAP_REPORT`）

`tsuzuri build --emit exe --trap-info` で生成した macOS / Linux のネイティブ実行ファイルは、フレームポインタを保持しており、実行時に環境変数 `TSUZURI_TRAP_REPORT` にファイルパスが設定されているとトラップ発生時に次の 1 行を追記します（`tsuzuri run` も内部でこの機構を利用しています）。

```text
tz-trap/1 2 0x2188000 0 0x1021884e4 0x10218856c 0x1021885c0
```

各フィールドは順に「フォーマット版（`tz-trap/1`）」「`.trap.json` のサイト ID」「ASLR スライド値」「32 フレーム打ち切りフラグ（`0` または `1`）」「最内フレームからの戻りアドレス列」です。各戻りアドレスからスライド値と `1` を引いた値を `llvm-symbolizer --obj=<実行ファイル>`（macOS の `-g` では `<実行ファイル>.dwarf`）に渡すことで、本番環境で採取したログからオフラインで関数名とソース行を復元できます。

## 最適化時および WebAssembly の注意点

- `-O1`〜`-O3`・`-Os`・`-Oz` で `-g` を付けた場合も構造的に正しい DWARF が生成されますが、LLVM の最適化によって死活変数の消去や関数のインライン化が行われるため、一部のローカル変数が `<variable not available>` になることがあります。
- `--target wasm32 -g` は `.wasm` 内のカスタムセクション（`.debug_info` 等）に DWARF を保持し、関数名セクション（name section）を付与します。WebAssembly トラップ境界ヘルパー `createBoundary(..., { frames: true })` と組み合わせることで、エラー時のスタックフレームに Tsuzuri 関数名を付与できます（[WebAssembly 出力](./webassembly.md) 参照）。

## 関連項目

- [CLI とサブコマンド](./cli.md)
- [コンパイラオプションと環境変数](./options.md)
- [診断メッセージとエラーコード](./diagnostics.md)
- [WebAssembly 出力](./webassembly.md)
- [Test](../stdlib/testing/test.md)
