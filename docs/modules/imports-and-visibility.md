# インポート（using）と可視性

Tsuzuri はプロジェクト内の全モジュールを自動認識するためファイル単位の読み込み宣言を必要としませんが、長い名前空間修飾を省略するための `using` 宣言と、モジュールの内部実装を隠蔽するための `private` 可視性修飾子を備えています。公開 API と内部実装の境界を明確に保つことで、不変条件の保護と安全なリファクタリングを両立できます。

## 要点

- `using 名前空間` をファイル先頭（`namespace` の直後）に記述すると、その名前空間直下の全モジュールを名前空間修飾なしで参照できる。
- 複数の `using` によって同名モジュールが衝突した場合は暗黙の優先選択を行わず、`E1004` として明示修飾を要求する。
- 標準ライブラリ `std` は全ファイルで暗黙に可視であり、基本モジュール（常時ロード）と専門モジュール（コードから参照されたときのみ自動ロードされる opt-in モジュール）に分かれている。
- 宣言の可視性は既定で**公開（public）**であり、モジュール内に隠蔽する宣言にのみ `private` を付与する（`internal` のようなパッケージ内限定キーワードは存在しない）。ホスト環境（C ABI / WebAssembly）向けのシンボル公開には `export def` を用いる。
- 公開シグネチャから `private` 型を漏洩させると `E1022` となる。標準ライブラリの不透明レコードや、`private record` と公開関数を組み合わせたカプセル化によって型の不変条件を保護できる。

## `using` 宣言と名前の衝突解決

### 基本構文と配置規則

`using` 宣言は、`namespace` 宣言の直後（`namespace` を省略したファイルでは最初の宣言位置）に1行ずつ記述します。階層パスは空白を入れずに `::` で連結します。

```tsuzuri project=using-demo file=Billing/Tax.tz
namespace Acme::Billing

def apply_rate :: i64 -> i64 = \amount ->
    amount + amount / 10
```

```tsuzuri project=using-demo file=Main.tz run=1100
namespace Acme

using Acme::Billing

Tax.apply_rate 1000
```

`using` の解決と制約には次の規則が適用されます。

- **相対パスの解決**: `using` に指定するパス自体も現在のファイルの名前空間を起点に解決されます。上の `Main.tz` は `namespace Acme` に属しているため、`using Billing` と短縮して書いても `Acme::Billing` に解決されます。
- **直下モジュールのみ対象（非再帰）**: `using Acme` と書いても、取り込まれるのは `Acme` 直下のモジュールのみであり、下位名前空間 `Acme::Billing::Tax` を `Billing::Tax` や `Tax` へ平坦化することはありません。
- **モジュール単体の指定禁止（`E1011`）**: `using Acme::Billing::Tax` のように名前空間ではなくモジュール名を指定すると `E1011`（`is a module, not a namespace`）となります。モジュールを持たない空・未定義の名前空間や、同一名前空間の重複 `using` も `E1011` です。
- **配置違反（`E0002`）**: `def` や `record` など他の宣言の後ろに `using` を置くと構文エラー `E0002` になります。なお `using` は文脈キーワードであるため、関数内のローカル変数名としては使用できます。

### 衝突検出（`E1004`）と解決方法

自ファイルと同じ名前空間に同名モジュールが存在する場合は、常に自名前空間のモジュールが最優先されます。一方、自名前空間に該当モジュールがなく、複数の `using` 宣言先から同名の公開モジュールが同時に可視化された場合、コンパイラは曖昧性エラー `E1004` を報告します（F# の `open` のように後から書いた宣言で黙って上書きすることはありません）。

```text
namespace App

using Analytics::Report
using Accounting::Report

// Summary モジュールが両方の名前空間にある場合、無修飾参照は E1004
let total = Summary.compute ()
```

このコードに対する診断出力は次のとおりです。

```text
error[E1004]: 'Summary' is ambiguous: using declarations make the modules 'Analytics::Report::Summary', 'Accounting::Report::Summary' visible; qualify it with its namespace
```

衝突が発生した箇所では、`Analytics::Report::Summary.compute ()` のように名前空間プレフィックスを明示して一意に指定します。

## 標準ライブラリ `std` の常時可視モジュールと opt-in モジュール

すべての標準ライブラリモジュールは `std` 名前空間に属しており、`using std` を書かなくても任意のファイルからモジュール名で直接利用できます。

コンパイル速度と出力バイナリサイズを最適に保つため、`std` のモジュールは内部的に**常時ロードされる基本モジュール**と、**ソースコード上で名前が参照されたときだけ自動的に読み込まれる opt-in モジュール**に分かれています。いずれの分類でも、利用時に特別なインポート設定やフラグは不要です。

| 分類 | 含まれる標準モジュール | コンパイラの扱い |
| --- | --- | --- |
| 常時可視・常時ロードモジュール | `Maybe`, `Result`, `Array`, `List`, `Vec`, `FixedArray`, `String`, `Utf8String`, `Char`, `Utf8Char`, `Text`, `Format`, `Math`, `Int`, `BigInt`, `Simd`, `Map`, `Set`, `HashMap`, `HashSet`, `Seq`, `Monoid`, `Exception`, `IO`, `File`, `Dir`, `Path`, `Env`, `Time`, `Random`, `Os`, `Process`, `Parallel`, `Routine`, `Rc`, `Arc`, `Owned`, `Dyn`, `FnPtr`, `Gpu`, `Debug`, `Test` | 常に型検査コンテキストへ読み込まれ、使用された関数のみがリンク・出力される |
| opt-in（オンデマンド）モジュール | **メモリ・補助**: `Arena`, `Anchor`, `ZString`, `Domain`, `Monoids`<br>**テキスト・符号化**: `Unicode`, `Regex`, `RegexText`, `Json`, `Cbor`<br>**数値・多次元計算**: `Complex`, `Slice`, `Matrix`, `MatrixView`, `Tensor`, `RandomTensor`<br>**並行・同期・通信**: `Channel`, `SendOnly`, `ReceiveOnly`, `DataChannel`, `Atomic`, `Mutex`, `RwMutex`, `Cond`, `Semaphore`, `Once`, `OnceValue`, `WaitGroup`, `SyncMap`, `Context`, `ErrGroup`, `Timer`, `Ticker`, `Net`<br>**計測・検証**: `Alloc`, `Bench`, `Gen` | ユーザーコードがモジュール名や関連型クラス（`deriving (Encode, Decode)` → `Json`、`Arbitrary` → `Gen`、`Time.after` → `Channel` 等）を参照したときにのみ依存先（`Regex` → `Unicode`、`Cbor` → `Json` 等）とともに自動ロードされる |

たとえば `Regex` や `Unicode` を使わないプログラムでは、Unicode 文字特性テーブルの解析やコード生成は一切行われません。なお、opt-in モジュールの型やコンストラクタは常に `Json.Null` や `Arena.Handle<T>` のようにモジュール修飾付きで記述します。

## 可視性修飾子（既定公開・`private`・`export`）

### 可視性の設計体系

Tsuzuri の可視性モデルは非常に簡潔であり、宣言の可視性は次の区分で構成されます。

| 指定方法 | 可視範囲 | 対象と役割 |
| --- | --- | --- |
| 修飾子なし（既定） | **公開（public）**: 同一パッケージ内および依存元パッケージの全モジュールから参照可能 | モジュールの公開 API となる関数・型・定数・型クラス・インスタンス |
| `private` | **モジュール内限定**: 宣言を含むそのファイル（1モジュール）の内部からのみ参照可能 | 内部ヘルパー関数、モジュール内部専用の補助データ型・定数・FFI バインディング |
| `export`（`export def`） | **ホスト ABI 公開**: Tsuzuri 内の公開に加え、C ABI シンボル（`tz_<名前>`）や WebAssembly エクスポートを生成 | C / C++ / C# / Python / JavaScript 等のホストプログラムから呼び出される境界関数 |

> 設計上の注意: F# の `internal` や Rust の `pub(crate)` に相当する「パッケージ内限定公開」のキーワードは Tsuzuri には存在しません。複数モジュール間で共有しつつ外部利用者向けではない内部補助モジュールを設ける場合は、専用の下位名前空間（例: `MyPkg::Detail`）に分離してドキュメント上で内部用と明記するか、1つのモジュール内に収めて `private` を付与します。

### `private` を付与できる宣言と禁止される組み合わせ

| 宣言構文 | 可否 | 規則・違反時の診断 |
| --- | --- | --- |
| `private def` / `private pure def` / `private const def` | 可 | 対応する `fn` / `and` / `let` 実装は自動的に `private` を継承する（実装側に `private fn` と重ねて書くと `E1022`） |
| `private @literal def` / `@literal private def` / `private const` | 可 | モジュール内限定のコンパイル時定数 |
| `private record` / `private union` / `private type` | 可 | モジュール内限定の型（`private union` の全ケースコンストラクタも非公開） |
| `private extern def` / `private extern view def` / `private extern type` | 可 | C / ホスト API の生バインディングをモジュール内部に閉じ込め、安全な公開ラッパー関数のみを提供する際に有効 |
| `private class` / `private instance` | 不可（`E1022`） | 型クラスとインスタンスはプログラム全体の一貫性（coherence）を保つため常に public |
| `.tc` ビルダーの基本操作（`Bind`・`Return` 等） | 不可（`E1022`） | コンピュテーション式展開に必要なため public 必須（`.tc` 内の補助関数は `private` 可） |
| `private export def` / `export private def` | 不可（`E1022`） | モジュール非公開とホスト公開は矛盾するため併用不可 |

### `private` 型の漏洩禁止（`E1022`）

公開（public）な宣言の型シグネチャやフィールド定義に `private` な型を含めることはできません。呼び出し元モジュールから名前を参照できない型が境界に現れることを防ぐため、コンパイラは `E1022`（`private_type_in_public_api`）を報告します。

- 公開 `def` の引数型・戻り値型・型クラス制約に `private` 型が現れる場合
- 公開 `record` のフィールド型や公開 `union` のケースペイロード型に `private` 型が現れる場合
- 公開 `type` エイリアスの右辺に `private` 型が現れる場合

なお、他モジュールにある `private` な型や関数は無修飾名の探索候補から除外されるため、別モジュールが同名の公開型を定義していても曖昧性エラー（`E1004`）を引き起こしません。

## 不透明型とカプセル化による不変条件の保護

データ構造の不変条件（例: 「分母は非ゼロ」「バッファ長とインデックスの整合性」「ソート済み配列の維持」）を守るには、外部からフィールドを直接書き換えたり不正な値でリテラル構築したりできないようにする必要があります。

### 標準ライブラリの不透明レコード（opaque record）

標準ライブラリのコレクションやリソースハンドル（`Map`、`Set`、`HashMap`、`Arena`、`Arena.Handle`、`Mutex`、`OnceValue`、`Channel`、`Tensor`、`Matrix`、`File.Handle`、`ZString` など）は、コンパイラによって内部表現が**不透明（opaque）**として保護されています。ユーザーコードから `Map { ... }` のように直接構築したり、パターンマッチや `.field` で内部フィールドへアクセスしたりすると `E1022`（`the representation of '...' is opaque; use its module API`）で拒否されます。

### ユーザーモジュールにおける不変条件保護パターン

ユーザー定義の公開 `record` では個別のフィールドだけに `private` を付ける構文はありません（公開 `record` の全フィールドは公開されます）。そのため、ユーザーモジュールで不変条件を保護する場合は次の2つのパターンを使い分けます。

1. **モジュール内部への表現隠蔽（`private record` + ハンドル/操作関数）**: 内部状態そのものを `private record` やモジュール内部の検証済み構造に閉じ込め、公開 API ではプリミティブ識別子や公開ラッパーを介した操作関数だけを公開します。
2. **スマートコンストラクタ規約（`make` / `try_create`）**: 値オブジェクトとして受け渡すレコードでは、検証を行う構築関数（`Result` や `Maybe` を返す `try_create`）を同モジュールに用意し、境界で不変条件を検査します。

次の例では、内部のトークン表現を `Auth::Session` モジュール内の `private record` に閉じ込め、検証を通過した公開 ID のみを発行・照合しています。

```tsuzuri project=encapsulation file=Auth/Session.tz
namespace Auth

private record RawKey { user_id: i64, checksum: i64 }

private def pack :: RawKey -> i64 = \k ->
    k.user_id * 1000 + k.checksum

private def unpack :: i64 -> Maybe<RawKey> = \token ->
    if token <= 0 then
        Maybe.None
    else
        let uid = token / 1000
        let sum = token % 1000
        if uid > 0 && sum == (uid * 37) % 1000 then
            Maybe.Some (RawKey { user_id: uid, checksum: sum })
        else
            Maybe.None

def issue :: i64 -> Result<i64, string> = \user_id ->
    if user_id <= 0 then
        Result.Error "invalid user id"
    else
        Result.Ok (pack (RawKey { user_id: user_id, checksum: (user_id * 37) % 1000 }))

def verified_user :: i64 -> i64 = \token ->
    match unpack token with
    | Maybe.Some key -> key.user_id
    | Maybe.None -> -1
```

```tsuzuri project=encapsulation file=Main.tz run=42
namespace App

using Auth

match Session.issue 42 with
| Result.Ok token -> Session.verified_user token + (Session.verified_user 9999 + 1)
| Result.Error _ -> 0
```

`Main.tz` からは `RawKey` 型や `pack` / `unpack` 関数には一切アクセスできず（参照すると `E1022`）、改ざんされたトークン `9999` は `verified_user` で確実に拒否されます。

## 関連項目

- [名前空間とモジュール](namespaces-and-modules.md)
- [パッケージと Tsuzuri.toml](packages.md)
- [ドキュメントコメントと doctest](doc-comments.md)
- [レコード](../types/records.md)
- [ネイティブ相互運用（C ABI）](../compiler/native-interop.md)
- [WebAssembly](../compiler/webassembly.md)
