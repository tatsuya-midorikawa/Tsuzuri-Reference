# Test

`Test` は、言語組み込みの `test` 宣言内で用いる基本アサーション関数（`equal`・`not_equal`・`is_true`）を提供する標準モジュールです。テストの検出・コンパイル・プロセス隔離実行・カバレッジ収集は `tsuzuri test` コマンドが担います。

## 要点

- `test "テスト名" = 本体式` は `unit` を返すトップレベル宣言であり、通常のビルド成果物（`tsuzuri build` / `run`）には含まれません。
- `Test.equal` と `Test.not_equal` は共有借用（`ref 'a`）で値を比較し、不一致時は `assert` と同じトラップで失敗します。
- `tsuzuri test` はテスト 1 件ごとに独立したサブプロセスで実行するため、あるテストがトラップしても残りのテストの実行・集計は継続されます。
- テスト実行中はルートパッケージ内の整数演算（`+`・`-`・`*`・`**`・単項 `-`）の意図しない折り返し（オーバーフロー）が既定で検出され、発生したテストは失敗になります。
- プロパティベーステストには [`Gen`](./gen.md)、ヒープ確保回数の検証には [`Alloc`](./alloc.md)、トラップの隔離検証には [`Domain.run`](../core/domain.md) を組み合わせます。

## `test` 宣言とアサーションの記述

```text
test "テスト名" = 本体式
```

`test` 宣言は `.tz` および `.tc` ファイルのトップレベルに記述します（型クラス定義ファイル `.tt` や標準ライブラリ内には書けず `E1018` となります）。`private`・`export`・`rec` は付与できません（`private test` は `E1022`、`export test` は `E0002`）。同一モジュール内の `private` 関数や型にはそのままアクセスでき、テスト専用プロジェクトでは `Main.tz` も不要です。

```tsuzuri project=checks file=Checks.tz
private def calc_total :: i64 -> i64 -> i64
fn calc_total price qty = price * qty

test "単価と数量の積が合計と一致する" =
    let actual = calc_total 120 3
    let expected = 360
    Test.equal expected actual

test "リテラル同士の比較は ref を明示する" =
    Test.equal (ref 360) (ref (calc_total 120 3))

test "品目名が異なることを確認する" =
    Test.not_equal "tea" "coffee"

test "在庫数が注文数以上である" =
    Test.is_true (5 >= 2)
```

### 失敗系・トラップ系の検証パターン

`Test` には例外やトラップを捕捉する専用関数はありません。検査対象の失敗種別に応じて次の方法を使い分けます。

- **`Result` / `Maybe` を返す関数**: `Test.is_true` で真偽値に潰さず、`match` で期待する `Error` や `None` ケースを直接検証します。
- **検査付き算術（`@checked`）などの検査例外**: `try ... with` 式で `Result` として受け取って検証します。
- **純粋計算のトラップ（`assert` や境界外アクセスなど）**: [`Domain.run`](../core/domain.md) でトラップを `Result` へ隔離して失敗を検証します。

```tsuzuri project=trap_check file=TrapCheck.tz
def positive_only :: i64 -> i64
fn positive_only x =
    assert (x > 0)
    x * 2

test "0 以下の入力でトラップすることを検証する" =
    let outcome = Domain.run (\() -> positive_only 0)
    Test.is_true (Result.is_error outcome)
```

## `tsuzuri test` ランナーとの連携

```sh
tsuzuri test .
tsuzuri test . --filter "Checks.単価"
tsuzuri test . --list
tsuzuri test . --json
tsuzuri test . --coverage coverage.info
tsuzuri test . --seed 42
tsuzuri test . --doc
tsuzuri test . --index 0 -g -o .tsuzuri/test/runner
```

| オプション | 動作 |
| --- | --- |
| `--filter TEXT` | `<モジュール名>.<テスト名>` に対する部分文字列一致（正規表現ではない）。不一致分は `ignored` |
| `--index N` | 宣言順 0 始まりの指定インデックスのみを実行（範囲外は `E2000`） |
| `--list` | 型検査のみを行い、`0 Module.name` 形式で一覧表示して終了 |
| `--json` | 各テスト結果と `summary`（および `coverage`）を NDJSON（1 行 1 JSON）で標準出力へ出力 |
| `-O0` 〜 `-O3` | 最適化レベル（既定は `-O0`） |
| `--target native\|wasm32\|wasm64\|TRIPLE` | 実行ターゲット（WASM 実行には Node.js が必要） |
| `--coverage PATH` | 成功したテストの行・関数カバレッジを lcov 形式で `PATH` に出力（ネイティブ専用） |
| `--seed N` | [`Gen`](./gen.md) プロパティベーステストの乱数シード（`0..=18446744073709551615`）を指定 |
| `--doc` | ドキュメントコメント `///` 内のコード例（doc-test）を検証（[ドキュメントコメント](../../modules/doc-comments.md)） |
| `--allow-overflow` | ルートパッケージ内の整数折り返しを失敗にせず警告出力のみにする |
| `-g -o PATH` | `--index N` と併用し、デバッガ接続用の単体テストバイナリをビルド（実行はしない） |

### プロセス隔離・タイムアウト・出力収集

- 各テストは最大 `min(CPU コア数, 32, 対象件数)` 並列の別プロセスで実行され、出力順はソースの宣言順に整列されます。
- 1 テストあたりの制限時間は **30 秒**固定です（超過時は `timed out after 30000ms` として失敗）。
- 成功したテストの標準出力・標準エラー出力は破棄されます。失敗したテストが標準エラー出力へ書き出した末尾 64 KiB（[`Debug.print`](../core/debug.md) や [`Gen`](./gen.md) の反例出力など）は失敗理由の直下に表示されます。
- 1 件でも失敗すると終了コード `1` となり、最初の失敗テストの位置に診断 `E2006` が報告されます。

### 整数折り返し（オーバーフロー）の自動検出

`tsuzuri test` はルートパッケージ内の `+`・`-`・`*`・`**`・単項 `-` が折り返したことを検出すると、既定でそのテストを失敗として報告します。ハッシュ計算や擬似乱数など折り返しが仕様の一部である演算には、[`Int.wrapping_add`](../numeric/int.md)・`Int.wrapping_sub`・`Int.wrapping_mul`・`Int.wrapping_neg` を明示します。

```tsuzuri project=wrapping file=Wrapping.tz
def step_hash :: i32 -> i32 -> i32
fn step_hash acc x = Int.wrapping_add (Int.wrapping_mul acc 31) x

test "折り返し演算を明示したハッシュ更新" =
    Test.equal (ref 1870457863) (ref (step_hash 2000000000 7))
```

## 引数の順序

`Test` モジュールはテストハーネスのエントリーポイントとして引数順規則の免除対象であり（[標準ライブラリの規約](../conventions.md)）、`Test.equal expected actual`・`Test.not_equal expected actual` のように期待値 `expected` を第1引数、実測値 `actual` を第2引数に取ります。

## 公開 API

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Test.equal` | `Eq<'a> => ref 'a -> ref 'a -> unit` | `expected == actual` であれば成功し、異なればトラップ |
| `Test.not_equal` | `Eq<'a> => ref 'a -> ref 'a -> unit` | `expected != actual` であれば成功し、等しければトラップ |
| `Test.is_true` | `own bool -> unit` | 引数が `true` であれば成功し、`false` であればトラップ |

## 関連項目

- [Gen](./gen.md)
- [Bench](./bench.md)
- [Alloc](./alloc.md)
- [Domain](../core/domain.md)
- [Int](../numeric/int.md)
- [標準ライブラリの規約](../conventions.md)
- [リソース管理とアサーション](../../expressions/resources-and-assertions.md)
- [CLI コマンド](../../compiler/cli.md)
- [コンパイラオプション](../../compiler/options.md)
- [デバッグ](../../compiler/debugging.md)
