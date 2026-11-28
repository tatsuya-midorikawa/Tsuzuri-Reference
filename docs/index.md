# Tsuzuri 言語リファレンス 総合目次

本書は、静的型付け・所有権モデル・関数型構文・LLVM バックエンドを備えたプログラミング言語 **Tsuzuri 0.1.0**（最新・既定エディション: **Edition 2028**）の公式言語リファレンスです。言語の設計思想から字句・構文規則、型システム、所有権と借用、モジュール管理、軽量並行処理（`tzroutine`）、全標準ライブラリモジュール、およびコンパイラ・ツールチェーン仕様までを全 9 部構成で網羅しています。

## 学習順序ガイド

はじめて Tsuzuri に触れる方は、以下の順序で読み進めることで段階的に全体像を習得できます。

1. **導入と全体像の把握**: [Tsuzuri とは](./overview/introduction.md) で言語の特徴を掴み、[CLI とサブコマンド](./compiler/cli.md) の手順でプロジェクトを作成・実行します。
2. **基本構文と関数型スタイル**: [束縛と値](./expressions/bindings-and-values.md)、[関数定義とカリー化](./expressions/functions.md)、[パターンマッチング](./expressions/pattern-matching.md)、[レコード型](./types/records.md)、[判別共用体（union）](./types/unions.md) を読み、式指向のデータモデリングを学びます。
3. **所有権と借用規約（Edition 2028）**: [所有権とムーブ](./ownership/ownership-and-move.md) と [借用と参照](./ownership/borrowing.md) で、GC なしでメモリ安全性を保証する規則と Edition 2027 以降の共有借用既定引数・スライス構文を理解します。
4. **実用アプリケーション構築**: [パッケージ管理](./modules/packages.md)、[標準ライブラリの設計規約と引数順序](./stdlib/conventions.md)、[IO](./stdlib/sys/io.md)、[tzroutine による軽量並行処理](./concurrency/tzroutine.md) へ進みます。

## 目的別クイックナビゲーション

| やりたいこと・調べたいこと | 参照先ページ |
| --- | --- |
| コンパイラの導入・サブコマンドの使い方を知りたい | [CLI とサブコマンド](./compiler/cli.md)・[コンパイラオプションと環境変数](./compiler/options.md) |
| エラーコード（`E1012` 等）や警告の意味を調べたい | [診断メッセージとエラーコード](./compiler/diagnostics.md) |
| Edition 2028 のスライス・末尾相対添字 `^k`・移行手順を知りたい | [安定性と互換性ポリシー](./compiler/stability.md)・[Slice](./stdlib/numeric/slice.md)・[Array](./stdlib/collections/array.md) |
| 所有権エラーや借用の競合・ライフタイムを解決したい | [所有権とムーブ](./ownership/ownership-and-move.md)・[借用と参照](./ownership/borrowing.md)・[ライフタイムとリージョン](./ownership/lifetimes.md) |
| パイプライン `\|>` に合わせた標準ライブラリの引数順を確認したい | [標準ライブラリの設計規約と引数順序](./stdlib/conventions.md) |
| C / C++ / C# / Python や WebAssembly（JS / TS）と連携したい | [ネイティブ連携と C ABI](./compiler/native-interop.md)・[WebAssembly 出力](./compiler/webassembly.md) |
| macOS で AppKit・Foundation などの Objective-C の API を呼びたい | [Objective-C 連携（`extern class` と `ObjC`）](./compiler/objective-c.md) |
| macOS のアプリ（`.app`）としてビルド・配置したい | [macOS のアプリケーションバンドル（`--emit app`）](./compiler/macos-app-bundle.md)・[Env](./stdlib/sys/env.md) |
| 並行処理・チャネル通信・データ並列計算を書きたい | [tzroutine による軽量並行処理](./concurrency/tzroutine.md)・[select 式](./concurrency/select.md)・[Parallel](./stdlib/sync/parallel.md) |
| AI エージェント（MCP・知識グラフ・ガイド）と連携したい | [MCP サーバー](./compiler/mcp.md)・[知識グラフ](./compiler/knowledge-graph.md)・[図表の自動生成](./compiler/diagrams.md) |

---

## 第1部: 言語の概要と設計思想

- [Tsuzuri とは](./overview/introduction.md) — 言語の特徴、コア機能、最小プログラムから見る全体像
- [設計思想とパフォーマンス戦略](./overview/design-philosophy.md) — 明示性・決定性・LLVM ネイティブ最適化を両立する設計原則
- [他言語との比較](./overview/comparison.md) — Rust・F#・Go・C++ との設計上の共通点と相違点

## 第2部: 字句構造・リテラル・文字列

- [字句構造・キーワード・文区切り](./syntax/lexical-structure.md) — 文字コード、コメント、予約語、トークン規則、インデントと文の区切り
- [リテラル](./syntax/literals.md) — 整数・2 進/10 進浮動小数点・任意精度整数・真偽値・文字・バイトリテラルの記法
- [文字列リテラルと文字コード表現](./syntax/strings.md) — UTF-16 `string` と UTF-8 `utf8string` の表現モデルとエスケープ規則
- [文字列補間と書式指定](./syntax/string-interpolation.md) — `$"..."` / `u8$"..."` による式埋め込みと整列・基数・精度のフォーマット指定子

## 第3部: 値・式・関数・制御構造

- [束縛と値](./expressions/bindings-and-values.md) — 不変束縛 `let`、可変束縛 `let mut`、コンパイル時定数 `const` と `const def`
- [演算子と式](./expressions/operators.md) — 算術・比較・論理・ビット・パイプライン `|>`・関数合成 `>>` / `<<` と参照オペランド
- [関数定義とカリー化](./expressions/functions.md) — `def` シグネチャ、カリー化と部分適用、純粋関数 `pure def`、再帰 `rec` / `and` と末尾呼び出し
- [ラムダ式とクロージャ](./expressions/lambdas.md) — `\x y -> ...` の構文、外側スコープの環境捕捉規則、クロージャの表現と最適化
- [契約と属性](./expressions/contracts-and-attributes.md) — 事前/事後条件 `@requires`・`@ensures`、効果表明 `@no_alloc` 等、`@checked`・`@cpu`・`@trusted`
- [条件分岐（if 式）](./expressions/conditionals.md) — `if ... then ... else ...`、`elif`、`unit` を返す `else` 省略形と型の統一
- [反復処理（for・while）](./expressions/loops.md) — コレクション・範囲走査 `for ... in`（`..<` / `..=`）、`for ... to/downto`、`while`、`break` / `continue`
- [パターンマッチングと match 式](./expressions/pattern-matching.md) — 構造分解、OR / AND パターン、型テスト `:?`、`when` ガード、網羅性と到達不能検査
- [アクティブパターン](./expressions/active-patterns.md) — 値を論理的なビューへ分解・変換する完全アクティブパターンと部分アクティブパターン
- [コンピュテーション式](./expressions/computation-expressions.md) — `.tc` ビルダー定義、`let!` / `do!` / `and!` / `match!` / `return` の展開規則とゼロコスト特殊化
- [例外処理とエラーハンドリング](./expressions/error-handling.md) — `Result` / `Maybe` による値ベースのエラー処理と、`@checked` 算術例外を捕捉する `try ... with ... finally`
- [スコープ付きリソース管理とアサーション](./expressions/resources-and-assertions.md) — `Drop` 実装型の自動解放を保証する `use` / `use!` 束縛と実行時検査 `assert`

## 第4部: 型システム

- [型システムの概要・unit・型エイリアス](./types/overview.md) — 静的型の分類、`unit` 型、透過的な型エイリアス `type` の定義規則
- [プリミティブ型](./types/primitive-types.md) — 固定幅符号付き/符号なし整数、IEEE 754 2 進/10 進浮動小数点（`f16`〜`f128`, `d32`〜`d128`）、`bool`、文字型
- [型キャストと数値変換](./types/casts.md) — 暗黙の型変換の排除、`as` 演算子による明示的キャストの丸め・飽和・ビット変換仕様
- [型推論と型つき穴](./types/type-inference.md) — Hindley–Milner ベースの局所型推論、リテラルの既定型決定、未完成箇所を調べる型つき穴 `?`
- [タプル型](./types/tuples.md) — `(A * B * ...)` の構築、パターン分解、比較・ハッシュの導出規則
- [レコード型](./types/records.md) — 名前付きフィールド構造体、レコード更新構文、アライメント最適化、フィールド単位の可変更新
- [判別共用体（union）](./types/unions.md) — 代数的データ型、ケースコンストラクタ、再帰型、タグ・ニッチ最適化によるメモリ表現
- [匿名共用体](./types/anonymous-unions.md) — 事前宣言不要の `(A | B)` 型、自動注入と拡大、型テストパターン `:? T as x` と JSON 変換
- [ジェネリックと高階型](./types/generics.md) — 型パラメーター `'a`、定数長配列パラメーター `const N: i64`、ランク 1 高階型（HKT）、静的単相化
- [型クラス・制約・動的ディスパッチ](./types/type-classes.md) — `.tt` によるクラス宣言、`instance` とオーファン規則、`deriving`、モジュール関数制約 `#fn`、`dyn` 型

## 第5部: 所有権とメモリ管理

- [所有権とムーブ](./ownership/ownership-and-move.md) — 単一所有者原則、`Copy` とムーブの境界、`own T` と Edition 2027 以降の引数渡し規約、最後の使用のコピー省略
- [借用と参照](./ownership/borrowing.md) — 共有借用 `ref T` と排他借用 `ref mut T`、可変引数 `mut T`、フィールド・スライスの部分借用とエイリアシング規則
- [ライフタイムとリージョン](./ownership/lifetimes.md) — 参照の生存期間検査、名前付きリージョン `{r}` を持つレコードと関数シグネチャ、ループ内の固定点解析
- [メモリレイアウトとスタック・ヒープ](./ownership/memory-layout.md) — スタック配置と `new` によるヒープ確保、エスケープ時の自動ヒープ昇格、バッファ再利用と `small` アロケータ
- [Drop と自動リソース解放](./ownership/drop.md) — `instance Drop<T>` によるデストラクタ実装、スコープ終了時・再代入時の決定的な解放順序と制約

## 第6部: モジュール・パッケージ・ドキュメント

- [名前空間とモジュール](./modules/namespaces-and-modules.md) — 1 ファイル 1 モジュール原則、拡張子（`.tz` / `.tt` / `.tc`）の役割、`namespace` 階層解決
- [インポートとアクセス制御](./modules/imports-and-visibility.md) — `using` による名前空間の展開、`private` 可視性と `export` ホスト公開境界
- [パッケージ管理](./modules/packages.md) — `Tsuzuri.toml` マニフェスト、`path` / `git` / `registry` 依存と `Tsuzuri.lock`、エディション指定、権限 `[capabilities]`
- [ドキュメントコメント](./modules/doc-comments.md) — `///` 記法、構造化タグ（`@deprecated`・`@complexity`・`@since`・`@see`）、`tsuzuri test --doc` による実行可能なコード例検証

## 第7部: 並行処理と遅延評価

- [tzroutine による軽量並行処理](./concurrency/tzroutine.md) — `tzroutine { ... }` と M:N スケジューラ、`Send` / `Sync` によるデータ競合防止、スコープ待機と JSPI WebAssembly 対応
- [select 式による多重チャネル待機](./concurrency/select.md) — 複数チャネルの送受信・タイムアウト・`when` ガード・`default` 分岐を公平に多重待機する構文
- [遅延評価（Lazy）](./concurrency/lazy.md) — 初回評価時のみ計算を実行して結果をメモ化する遅延値の評価モデル

## 第8部: 標準ライブラリリファレンス

### 共通規約

- [標準ライブラリの設計規約と引数順序](./stdlib/conventions.md) — パイプライン `|>` と関数合成に適した「処理対象（subject）を末尾引数に置く」統一規則と例外分類

### コア・エラー・デバッグ (`std` 基本モジュール)

- [Maybe](./stdlib/core/maybe.md) — 値の有無を型安全に表す `Maybe<'a>`（`Some` / `None`）と変換・計算式ビルダー
- [Result](./stdlib/core/result.md) — 成功と失敗を表す `Result<'ok, 'err>`（`Ok` / `Error`）とエラー伝播ビルダー
- [Exception](./stdlib/core/exception.md) — `@checked` 算術オーバーフロー等の関数内例外型とメッセージ取得
- [Domain](./stdlib/core/domain.md) — 純粋計算中の実行時トラップを隔離して `Result.Error` へ変換する `Domain.run`
- [Monoid と Monoids](./stdlib/core/monoid.md) — 単位元と結合的二項演算を定義する型クラスと並列畳み込み用ラッパー型
- [Debug](./stdlib/core/debug.md) — 値を借用または透過的に標準エラーへ出力する開発時トレース関数

### コレクション (`docs/stdlib/collections/`)

- [Array](./stdlib/collections/array.md) — 連続メモリ上の配列 `[T]`・固定長配列 `[T; N]`・スライス操作と計算量保証
- [Vec](./stdlib/collections/vec.md) — 動的伸長可能な所有連続バッファ `Vec<'a>` の追加・削除・整列・二分探索
- [List](./stdlib/collections/list.md) — チャンク連結構造を持つ不変リスト `[|'a|]` の関数型操作
- [Seq](./stdlib/collections/seq.md) — 要素をオンデマンドに生成・変換・消費する遅延シーケンス `Seq<'a>`
- [Map](./stdlib/collections/map.md) — 昇順チャンク配列による順序付き不変連想マップ `Map<'k, 'v>`
- [Set](./stdlib/collections/set.md) — 昇順チャンク配列による順序付き不変集合 `Set<'a>` と集合演算
- [HashMap](./stdlib/collections/hashmap.md) — 挿入順序を保持する高速ハッシュマップ `HashMap<'k, 'v>`
- [HashSet](./stdlib/collections/hashset.md) — 挿入順序を保持する高速ハッシュ集合 `HashSet<'a>`

### テキスト・文字・正規表現 (`docs/stdlib/text/`)

- [String](./stdlib/text/string.md) — UTF-16 コード単位列 `string` の検索・分割・置換・スライス・変換 API
- [Utf8String](./stdlib/text/utf8string.md) — 検証済み UTF-8 文字列 `utf8string` の検索・部分抽出・バイト/スカラー操作
- [Char と Utf8Char](./stdlib/text/char.md) — UTF-16 コード単位 `char` と Unicode スカラー値 `utf8char` の分類・変換
- [Text](./stdlib/text/text.md) — `string` と `utf8string` を共通のインターフェースで扱うポリモーフィック文字列操作
- [Format](./stdlib/text/format.md) — 文字列補間およびカスタム書式出力を支えるフォーマッタ基盤
- [Unicode](./stdlib/text/unicode.md) — Unicode 17.0.0 に準拠した正規化（NFC/NFD/NFKC/NFKD）、書記素境界、大文字・小文字変換
- [Regex と RegexText](./stdlib/text/regex.md) — 線形時間保証（Pike VM）を備えた正規表現コンパイル・検索・キャプチャ・置換
- [ZString](./stdlib/text/zstring.md) — Win32 `*W` API 等とゼロコピー連携する NUL 終端 UTF-16 文字列 `ZString`

### 数値・行列・テンソル・SIMD・GPU (`docs/stdlib/numeric/`)

- [Int](./stdlib/numeric/int.md) — 固定幅整数の検査付き算術・飽和算術・折り返し算術・ビットカウント・エンディアン変換
- [Math](./stdlib/numeric/math.md) — IEEE 754 浮動小数点の初等超越関数、丸め、FMA、NaN / 無限大判定と数学定数
- [BigInt](./stdlib/numeric/bigint.md) — 任意精度整数 `bigint` の四則演算・累乗・ビット操作・基数変換
- [Complex](./stdlib/numeric/complex.md) — 複素数型 `Complex<'a>` の四則演算・極座標変換・複素初等関数
- [Slice](./stdlib/numeric/slice.md) — 多次元ブラケット添字・範囲・末尾相対位置を表すスライス記述子
- [Matrix](./stdlib/numeric/matrix.md) — 行優先連続バッファを持つ 2 次元行列 `Matrix<'a>` の生成・変換・決定的行列積
- [MatrixView](./stdlib/numeric/matrix-view.md) — コピーなしで部分行列・行・列・転置を参照または排他更新するビュー
- [Tensor](./stdlib/numeric/tensor.md) — 任意次元配列 `Tensor<'a>` のブロードキャスト演算・軸操作・ビュー・インプレースカーネル
- [RandomTensor](./stdlib/numeric/random-tensor.md) — 乱数のテンソル生成（16 の分布）、ディリクレ分布・多変量正規分布、並べ替えと重み付き抽出（opt-in）
- [Simd](./stdlib/numeric/simd.md) — 128-bit / 256-bit 固定幅 SIMD ベクトル型のロード・ストア・レーン演算・水平リダクション
- [Gpu](./stdlib/numeric/gpu.md) — WebGPU / Vulkan コンピュートカーネルのデバイス要求とデータ並列ディスパッチ（実験的）

### スマートポインタ・メモリ管理・FFI 補助 (`docs/stdlib/memory/`)

- [Rc と Arc](./stdlib/memory/rc.md) — シングルスレッド用 `Rc<'a>` とスレッド安全 `Arc<'a>`（および `Weak` 参照）による共有所有
- [Arena](./stdlib/memory/arena.md) — 世代付きハンドル `Arena.Handle<'a>` による高速一括確保と循環グラフ表現
- [Owned](./stdlib/memory/owned.md) — 所有環境のみを捕捉する 1 回呼び出しクロージャ `Owned.Function`
- [FnPtr](./stdlib/memory/fnptr.md) — トップレベル関数を C ABI 関数ポインタ値 `FnPtr<'f>` として保持・受け渡しする型
- [Anchor](./stdlib/memory/anchor.md) — C 静的コールバック内から Tsuzuri 側の状態へ世代検証付きでアクセスするトークン

### 同期・チャネル・データ並列 (`docs/stdlib/sync/`)

- [Channel、SendOnly、ReceiveOnly](./stdlib/sync/channel.md) — `tzroutine` 間で値を送受信する双方向/単方向チャネル（バッファなし・容量付き対応）
- [DataChannel](./stdlib/sync/datachannel.md) — 送信端 `Sender` と受信端 `Receiver` を分離した容量付き MPMC キュー（WASM `threads` 対応）
- [Routine](./stdlib/sync/routine.md) — `tzroutine` の動的起動、協調的 `yield`、借用共有スコープ `Routine.scope`、OS スレッド固定
- [MainThread](./stdlib/sync/mainthread.md) — 処理をプロセスのメインスレッド（UI スレッド）へ戻す `post`・`after` とメインスレッド判定 `is_current`（macOS）
- [Atomic](./stdlib/sync/atomic.md) — 整数および `bool` に対するロックフリーなアトミック読み書き・CAS・算術更新
- [Mutex](./stdlib/sync/mutex.md) — 共有借用越しに内部値を排他保護するミューテックス `Mutex<'a>`
- [RwMutex](./stdlib/sync/rwmutex.md) — 複数同時読み取りと単一排他書き込みを制御する読み書きロック `RwMutex<'a>`
- [Cond](./stdlib/sync/cond.md) — ロックと組み合わせて条件成立まで `tzroutine` を待機・起床させる条件変数
- [Semaphore](./stdlib/sync/semaphore.md) — 同時実行数やリソース消費量を制限する重み付きセマフォ
- [Once と OnceValue](./stdlib/sync/once.md) — 複数 `tzroutine` から競合しても厳密に 1 回だけ初期化を実行するプリミティブ
- [WaitGroup](./stdlib/sync/waitgroup.md) — 複数の並行タスクの完了を待機する同期カウンタ
- [SyncMap](./stdlib/sync/syncmap.md) — 読み取り中心の並行ワークロードに適したスレッド安全連想マップ
- [Context](./stdlib/sync/context.md) — キャンセル信号とデッドラインを親子ツリーで伝播するコンテキスト
- [ErrGroup](./stdlib/sync/errgroup.md) — 複数の `tzroutine` を束ね、最初のエラー発生時にコンテキストを取り消して待機するグループ
- [Timer と Ticker](./stdlib/sync/timer.md) — 指定時間後の単発通知タイマーと一定周期のティッカーチャネル
- [Parallel](./stdlib/sync/parallel.md) — 配列チャンク分割と `Monoid` 還元による決定的なマルチコアデータ並列 API

### 入出力・OS・システム・ネットワーク (`docs/stdlib/sys/`)

- [IO](./stdlib/sys/io.md) — 純粋計算と副作用を分離する遅延入出力モナド `IO<'a>` と標準入出力関数
- [File](./stdlib/sys/file.md) — ファイルのテキスト/バイナリ読み書き、追記、アトミック保存、ストリームハンドル操作
- [Dir](./stdlib/sys/dir.md) — ディレクトリの作成、一覧走査、再帰削除、存在確認
- [Path](./stdlib/sys/path.md) — ホスト I/O を伴わない純粋なパス結合・正規化・拡張子/親ディレクトリ抽出
- [Env](./stdlib/sys/env.md) — 環境変数の取得、カレントディレクトリの参照、実行ファイルパスの取得
- [Os](./stdlib/sys/os.md) — OS 種別・アーキテクチャ判定および統一システムエラー型 `Os.Error`
- [Process](./stdlib/sys/process.md) — 外部プロセスの起動、引数・環境変数・標準入出力パイプの制御と終了ステータス取得
- [Time](./stdlib/sys/time.md) — 単調増加クロック、UTC システム時刻、時間単位定数、`tzroutine` 対応スリープ
- [Random](./stdlib/sys/random.md) — OS 暗号論的乱数取得と、シード再現性を持つ純粋擬似乱数生成器 `Random.Pcg`・`Random.Pcg64`（種の列 `SeedSequence`、独立なストリームの分岐、15 の確率分布）
- [Net](./stdlib/sys/net.md) — IPv4 / IPv6 アドレス解析、DNS 名前解決、ノンブロッキング netpoller 統合の TCP / UDP ソケット

### データシリアライズ (`docs/stdlib/encoding/`)

- [Json](./stdlib/encoding/json.md) — RFC 8259 準拠の JSON パーサー・シリアライザ、`Encode` / `Decode` 型クラス、ストリーミング処理
- [Cbor](./stdlib/encoding/cbor.md) — RFC 8949 準拠のコンパクトなバイナリ表現 CBOR のエンコード・デコード

### テスト・プロパティ検証・ベンチマーク (`docs/stdlib/testing/`)

- [Test](./stdlib/testing/test.md) — `test` 宣言の実行モデル、失敗報告、整数折り返し検出、LCOV カバレッジ計測
- [Gen](./stdlib/testing/gen.md) — 乱数データ生成と最小反例への自動縮小（シュリンク）を備えるプロパティベーステスト
- [Bench](./stdlib/testing/bench.md) — 反復回数の自動較正と最適化障壁 `Bench.consume` を備えたマイクロベンチマーク API
- [Alloc](./stdlib/testing/alloc.md) — counting アロケータと連動して区間内のヒープ確保回数・バイト数を検証する API

## 第9部: コンパイラとツールチェーン

- [CLI とサブコマンド](./compiler/cli.md) — 配布物の導入、全 26 サブコマンドの使い方、入力解決、ビルドキャッシュ、終了コード
- [コンパイラオプションと環境変数](./compiler/options.md) — 全 87 フラグ・全環境変数、最適化、PGO、`--backend fast`、`TSUZURI_RANGE_FLAGS`、`TSUZURI_STRINGS`
- [コンパイラディレクティブと条件分岐の代替](./compiler/directives.md) — プリプロセッサ非採用の設計理由と、属性・`Tsuzuri.toml`（全 8 セクション）・CLI による代替手法
- [対応プラットフォームとクロスコンパイル](./compiler/platforms.md) — サポート対象 5 環境、全 9 ネイティブトリプル、同梱ツールチェーン/`TSUZURI_SYSROOT` によるクロスビルド手順
- [診断メッセージとエラーコード](./compiler/diagnostics.md) — テキスト/JSON Lines/LSP の診断形式、全 73 エラー・警告コード解説、全 `kind` カタログ
- [デバッグ](./compiler/debugging.md) — DWARF / CodeView PDB 生成、LLDB 型フォーマッター、natvis、個別テストデバッグ、トラップバックトレース
- [ネイティブ連携と C ABI](./compiler/native-interop.md) — `export` / `extern`、`extern type`、`@c_layout`、`tsuzuri bindgen`、`--emit shared`、C# / Python / C++ バインディング、ThinLTO
- [Objective-C 連携（`extern class` と `ObjC`）](./compiler/objective-c.md) — macOS で Objective-C のクラスを型として宣言し、Cocoa のメソッドを型付きで呼び出す（所有・`Self`・構造体の値渡し・定数の NSString）
- [macOS のアプリケーションバンドル（`--emit app`）](./compiler/macos-app-bundle.md) — `Name.app` の生成、`[macos]` のバンドルのキー、`Info.plist`、ad-hoc の署名、`.dSYM`、置き換えの規則
- [WebAssembly 出力](./compiler/webassembly.md) — `wasm32` / `wasm64`、`--emit bindings-js`、`simd128`・`threads`・`tail-call`・`jspi`・`webgpu`・`net`、WASI
- [知識グラフ](./compiler/knowledge-graph.md) — `target/tz/kg/` の自動生成、要約カード、`tsuzuri kg` によるシンボル照会・型検索・影響分析（`impact`）
- [知識グラフのデータ形式](./compiler/knowledge-graph-format.md) — ノード・エッジ・事実・メモリレイアウト JSON Lines（`tz-kg/1` / `tz-facts/1`）の厳密スキーマ仕様
- [図表の自動生成](./compiler/diagrams.md) — `tsuzuri kg diagram` による 7 種の図表（Mermaid / Graphviz DOT / Markdown）と自動ビュー生成
- [MCP サーバー](./compiler/mcp.md) — AI エージェント向けの読み取り専用 Model Context Protocol サーバー（`tsuzuri mcp`）の全 12 ツールと設定方法
- [仕様規則体系と適合性テスト](./compiler/conformance.md) — 全 15 領域の仕様規則 ID（`AREA-NNN`）と適合性テストスイートによる継続的検証の仕組み
- [安定性と互換性ポリシー](./compiler/stability.md) — 安定性保証の対象と非保証範囲、エディション制度（2026 / 2027 / 2028）、`@deprecated`、`tsuzuri api-diff`
