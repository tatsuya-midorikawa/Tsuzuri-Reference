# Domain

`Domain` は、純粋計算の**トラップ隔離領域**を提供するモジュールです。`Domain.run` の内部で発生したゼロ除算、境界外添字、`assert` 失敗、網羅されない `match`、メモリ確保失敗などの言語トラップをプロセス終了させずに隔離し、領域内で確保されたヒープブロックをすべて回収した上で `Result.Error` として呼び出し元へ返します。外部入力や動的生成ロジックの安全な試行、およびテストコード内でのトラップ発生の検証に使用します。

`Domain` はオンデマンドで読み込まれる予約標準モジュールであり、ユーザーモジュール名として `Domain` を定義すると `E1011` となります。

## 要点

- `Domain.run (\() -> 式)` は、計算が正常終了すれば `Result.Ok value` を、トラップが発生すれば `Result.Error failure`（`Domain.Failure` 型）を返します。
- `Domain.Failure` はトラップ位置 ID（`site`）、トラップ種別番号（`kind`）、および発生箇所付きのメッセージ（`message`）を保持します。
- 隔離の安全性を保証するため、渡すクロージャは純粋（`pure`）であり、キャプチャする環境と戻り値の双方がプレーンデータ（関数値・`dyn`・`Rc`/`Arc`・extern ハンドル・ユーザー定義 `Drop` を含まない型）でなければなりません（違反時は `E1038`）。
- 対応環境はシステムアロケータを使用する **macOS および Linux のネイティブビルド**のみです（Windows・WebAssembly・`--freestanding`・カスタムアロケータでは `E1038`）。
- スタックオーバーフローおよび無限ループ（非停止）は隔離対象外です。

## 型定義と公開関数

```text
record Failure {
    site: i64,
    kind: i64,
    message: string,
}

Domain.run :: own (unit -> 'a) -> Result<'a, Domain.Failure>
```

| 要素 | シグネチャ / 型 | 説明 |
| --- | --- | --- |
| `Domain.Failure` | `record { site: i64, kind: i64, message: string }` | 隔離領域内で発生したトラップの位置・種別・説明文字列を保持するレコード |
| `Domain.run` | `own (unit -> 'a) -> Result<'a, Domain.Failure>` | 純粋な引数なしクロージャ（または `pure def` 名）をトラップ隔離領域内で1回実行し、結果を `Result` で返す |

### 引数の順序

`Domain.run` は実行本体のクロージャ1つだけを引数にとる1引数関数です（[標準ライブラリの設計規約と引数の順序](../conventions.md)）。`(\() -> 計算) |> Domain.run` のようにパイプラインで渡すことも可能です。

## 基本的な使い方

### トラップの隔離と継続実行

次の例では、整数配列の平均を求める純粋計算を空でない配列と空配列の双方に対して実行します。空配列では長さ `0` によるゼロ除算（`kind == 1`）が発生しますが、プロセスは異常終了せず `Result.Error` として回収されます。

```tsuzuri run=average%209%0Afailed%20(kind%201)
def average :: [i64] -> i64 = \xs -> Array.sum xs / xs.length

def describe :: Result<i64, Domain.Failure> -> string = \outcome ->
    match outcome with
    | Result.Ok value -> $"average {value}"
    | Result.Error failure -> $"failed (kind {failure.kind})"

def main :: unit -> i32 = \() ->
    let data = [4, 8, 15]
    let empty: [i64] = []
    do! IO.writeln (describe (Domain.run (\() -> average data)))
    do! IO.writeln (describe (Domain.run (\() -> average empty)))
    0
```

### テスト内でのトラップ検証

`tsuzuri test` の中で境界外アクセスや事前条件違反が意図どおりトラップすることを検証する際にも `Domain.run` を利用できます。

```tsuzuri
def elem_at :: i64 -> [i64] -> i64 = \idx xs -> xs[idx]

test "out-of-bounds access traps with kind 3" =
    let xs = [10, 20, 30]
    match Domain.run (\() -> elem_at 5 xs) with
    | Result.Error failure -> Test.is_true (failure.kind == 3)
    | Result.Ok _ -> Test.is_true false
```

## `Domain.Failure` とトラップ種別番号

`Failure` レコードの各フィールドは次の情報を保持します。

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `site` | `i64` | トラップ発生箇所の識別番号。`--trap-info` で出力される `.trap.json` サイドテーブルの `id` と一致する |
| `kind` | `i64` | トラップ種別番号（ホスト連携 `--trap-mode return` の `tsuzuri_trap_info.kind` と同一） |
| `message` | `string` | `<理由> at <ソースパス>:<行>:<列>` 形式の説明文（位置表を持たない `bench` 等では `<理由>` のみ） |

`kind` の値とトラップ理由の対応は次のとおりです。

| `kind` | トラップ理由（`.trap.json` 表記） | 発生条件の代表例 |
| --- | --- | --- |
| `0` | `assertion failed` | `assert` 式の条件が `false` |
| `1` | `integer division by zero` | 整数の `0` 除算・剰余（`x / 0`, `x % 0`） |
| `2` | `integer division overflow` | 最小負数の `-1` 除算（例: `i64` の最小値 `/ -1`） |
| `3` | `index out of bounds` | 配列・スライス・文字列の境界外添字アクセス |
| `4` | `allocation size overflow` | 要素数とサイズの積が上限を超える配列確保 |
| `5` | `allocation failed` | アロケータからのメモリ確保失敗（OOM） |
| `6` | `range step is zero` | ステップ幅 `0` の範囲生成 |
| `7` | `non-exhaustive match` | 非網羅 `match` の到達または `unreachable ()` |
| `8` | `pattern mismatch` | 反駁可能パターンの不一致 |
| `9` | `string length overflow` | 文字列連結や繰り返しによる最大長超過 |
| `10` | `numeric runtime trap` | 数値ランタイム補助関数での定義域・変換トラップ |
| `11` | `wasm runtime trap` | WebAssembly 専用トラップ（`Domain.run` 非対応ターゲットのため出現しない） |
| `12` | `invalid Unicode encoding` | 不正な符号列のデコード失敗 |
| `13` | `debug output failed` | デバッグ出力失敗（純粋本体では発生しない） |
| `14` | `stack overflow` | スタック枯渇（隔離不能のためプロセスが終了し `Failure` としては返らない） |
| `15` | `unhandled OverflowException: ...` | `try ... with` の外で発生した `@checked` 算術オーバーフロー |
| `16` | `contract requires failed` | 呼び出し先関数の事前条件 `@requires` 違反 |
| `17` | `contract ensures failed` | 呼び出し先関数の事後条件 `@ensures` 違反 |

## 静的検査規則（`E1038`）

外部状態の破損やリソースリークを防ぐため、コンパイラは `Domain.run` の各呼び出し箇所で以下の6条件を順に検査し、違反があれば `E1038` を報告します。

| 検査項目 | 診断 `kind` | 要件 |
| --- | --- | --- |
| 直接呼び出し | `domain_not_called_directly` | `Domain.run` を関数値として変数に束縛したり高階関数へ渡したりせず、クロージャを伴って直接呼び出すこと |
| クロージャ形式 | `domain_argument_not_closure` | 引数はその場に記述したラムダ式 `\() -> ...` または `pure def` 関数の名前であること（変数に入ったクロージャは不可） |
| キャプチャの制限 | `domain_capture_not_plain` | ラムダがキャプチャする値（`ref` を1段剥がした中身を含む）がすべてプレーンデータであること |
| 本体の純粋性 | `domain_body_not_plain` / `domain_body_not_pure` | 本体およびそこから到達するすべての呼び出し（入れ子の `Domain.run` を含む）が `pure def` と同じ純粋性規則を満たすこと |
| 戻り値の制限 | `domain_result_not_plain` | 戻り値型 `'a` がプレーンデータであること |
| ターゲット要件 | `domain_target_unsupported` | システムアロケータを用いるネイティブ POSIX（macOS / Linux）ビルドであること |

ここで**プレーンデータ**とは、関数値（クロージャ・関数ポインタ）、型消去オブジェクト `dyn`、参照カウント `Rc` / `Arc`、`extern` ハンドル、およびユーザー定義 `Drop` インスタンスのいずれも含まない型（プリミティブ、文字列、配列、`Vec`、`List`、プレーンなレコード・共用体・タプルなど）を指します。

```text
let f = \() -> 1 / 0
let a = Domain.run f                                // E1038: 変数経由ではなくラムダを直接渡す必要がある
let b = Domain.run (\() -> { Debug.print "x"; 1 })  // E1038: 本体が副作用（デバッグ出力）を持つ
```

## 対応ビルド条件とメモリ管理の仕組み

| ビルド条件 | 挙動 |
| --- | --- |
| macOS / Linux ネイティブ + システムアロケータ（`build`, `run`, `script`, `test`, `bench`） | 利用可能（入れ子の `Domain.run` や `--trap-mode return` 境界内での併用にも対応） |
| `--emit llvm` | `--trap-mode return` の併用が必要（リンク時にホスト側でランタイムの `trap.c` を組み込む） |
| Windows ネイティブ、`wasm32` / `wasm64`、`--freestanding`、`--allocator host` / `counting` / `small`、`bench --allocs`、`Alloc` モジュール併用テスト | `E1038`（コンパイル時拒否） |
| `extern` 関数へコールバックを渡すプログラム | `E2000`（ホストスタックフレームを跨ぐ非局所ジャンプを防止するため併用不可） |

`Domain.run` を含むプログラムは追跡付きヒープを用いて動作します。
- **正常終了時**: 結果値 `'a` が保持するヒープブロックの所有権は外側の呼び出し元へ引き継がれます。
- **トラップ発生時**: その隔離領域内で確保されたすべてのヒープブロックが一括解放され、制御は最も内側の `Domain.run` の入口へ復帰します。キャプチャされた外部変数は呼び出し時に領域内へ複製されるため、元の値が破壊されることはありません。大きな配列をキャプチャする場合は、値コピーを避けるため共有参照（`ref`）でキャプチャするとオーバーヘッドを抑えられます。

## 関連項目

- [Result](./result.md)
- [Exception](./exception.md)
- [関数定義（純粋関数 `pure def`）](../../expressions/functions.md)
- [エラー処理と try 式](../../expressions/error-handling.md)
- [Test](../testing/test.md)
- [診断コード一覧](../../compiler/diagnostics.md)
