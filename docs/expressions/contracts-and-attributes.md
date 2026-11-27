# 契約と属性

Tsuzuri は、関数の事前条件・事後条件をコードとして明記する**契約（`@requires`・`@ensures`）**と、定数化・オーバーフロー検査・CPU 命令セット振り分け・静的効果検証・FFI メモリ配置などをコンパイラに指示する **16 個の組み込み属性**を提供します。契約と効果表明は、実行時検査・プロパティベーステスト・SMT ソルバーによる形式証明まで一貫した仕組みで統合されています。

## 要点

- 関数の入口条件を `@requires 条件`、出口条件を `@ensures \r -> 条件`（入口時点のスナップショットは `@old (式)`）として関数本体の先頭に記述できます。
- 契約は `--contracts` オプションの 4 モード（`off`・`check`・`test`・`prove`）で切り替えられ、`tsuzuri prove` による SMT 証明や `tsuzuri test --contracts test` による反例縮小付き自動テストにそのまま利用できます。
- 契約は最適化の安全前提（未定義動作の仮定）としては一切使われず、`off` モードの生成コードは契約を書かない場合とバイト単位で一致します。
- 宣言や式に付与できる属性は `@checked`、`@literal`、`@cpu`、`@no_alloc`、`@no_copy`、`@no_trap`、`@terminates`、`@trusted`、`@count`、`@c_layout`、`@link`、`@weak`、`@returns_retained`、`@returns_not_retained`、`@json`、`@alias` の 16 個に厳密に限定されており、未知の属性やユーザー定義属性は `E0002` になります。
- 非推奨 API の告知には属性ではなくドキュメントコメントの `/// @deprecated` タグ（`W1005`）を用います。また型変数制約行 `@'a : Eq` は属性とは別の構文です。

---

## 契約（@requires・@ensures・@old）

### 契約の構文と配置規則

トップレベル関数の本体先頭（`=` や最内ラムダ `->` の直後の行）に、本体の文と同じインデントで `@requires` と `@ensures` を連続して記述します。

```tsuzuri run=8
def clamp :: i64 -> i64 -> i64 -> i64 = \lo hi x ->
    @requires lo <= hi
    @ensures \r -> lo <= r && r <= hi
    if x < lo then lo elif x > hi then hi else x

clamp 0 8 20
```

- **評価時点**: `@requires` は関数入口で上から順に評価され、偽なら `contract requires failed` でトラップします。`@ensures` は戻り値をラムダ引数（`\r -> ...`、不要なら `\_ -> ...`）に束縛して関数出口で上から順に評価され、偽なら `contract ensures failed` でトラップします。
- **純粋性と不変性（`E1033`）**: 契約の条件式は `pure def` と同じ純粋性規則を満たす `bool` 式でなければならず、かつ引数や戻り値を書き換える操作（再代入、`ref mut` 借用、`mut` 引数関数への受け渡しなど）はすべて `E1033`（`contract_writes`）で禁止されます。これにより `off` と `check` で関数の計算結果が変わらないことが保証されます。
- **`@old (式)` による入口値の参照**: `@ensures` の内部に限り、`@old (xs[0])` のように書くことで、可変スライスや `ref mut` 引数が関数本体で書き換えられる前の「入口時点の値」を参照できます。`@old` は数値や `bool` などの平たい Copy 型の式のみを受け取り、入れ子にはできません（違反は `E1033`）。
- **適用対象と制約**: 通常の `def`、`pure def`、`export` / `private`、`def rec`、`@cpu` 関数、ジェネリック関数に記述できます。一方、`const def`、型クラスの `instance` メソッドや既定実装、カリー化の途中段階で返される内側ラムダ、および参照（`ref T`）を含む戻り値型の `@ensures` には記述できません（`E1033`）。また `@ensures` を持つ再帰関数は出口検査を行うため自己末尾呼び出しのループ化が行われません（`@requires` のみであれば末尾再帰最適化は維持されます）。

### 契約の 4 モードと CLI 連携

| モード | 動作内容 | 実行時コスト | 主な利用場面 |
| --- | --- | --- | --- |
| `off` | 型検査・所有権検査・純粋性検査のみ実施し、検査コードを出力しない | 0（IR 完全一致） | `tsuzuri build`、`tsuzuri bench` の既定 |
| `check` | 入口と出口で契約式を評価し、偽の場合に位置情報付きでトラップする | 条件式の評価分 | `tsuzuri run`、`tsuzuri script`、`tsuzuri test` の既定 |
| `test` | `check` に加え、契約を持つ関数ごとにプロパティテストを自動生成・実行する | テスト実行時のみ | `tsuzuri test --contracts test` |
| `prove` | SMT ソルバーで事前証明を実行し、証明成功後に `check` として続行する | コンパイル時の証明時間 | `tsuzuri prove`、`--contracts prove` |

- **プロパティテスト自動生成（`tsuzuri test --contracts test`）**: 契約を持つ関数に対して `Arbitrary` インスタンスからランダム入力を生成し、`@requires` を満たす入力について `@ensures` を検証します。違反が見つかると最小化された反例（shrunk counterexample）と再現用 `--seed` 値を報告します。ジェネリック関数や `Arbitrary` を持たない引数型の関数はスキップされ、警告 `W1009`（`contract_test_skipped`）で通知されます。
- **SMT ソルバーによる静的証明（`tsuzuri prove`）**:
  ```sh
  tsuzuri prove [source.tz|directory] [--function NAME]... [--prove-timeout SECONDS] [--json]
  ```
  `@requires` の仮定のもとで「関数本体がゼロ除算・オーバーフロー除算・`assert` 失敗などのトラップを起こさないこと（`trap_free`）」および「すべての `@ensures` が成立すること」をビットベクトル論理（SMT-LIB `QF_BV`）へ変換し、外部ソルバー（環境変数 `TSUZURI_SMT`、`z3`、`cvc5` の順で探索）で検証します。反例が存在する場合は具体的な引数と失敗理由を `E1034` で出力します。整数・`bool`・タプル・レコード・ペイロードなし共用体・`if`・`match`・`let`・非再帰関数呼び出し（深さ 8 まで展開）・`Int.min` / `max` / `abs`・`assert` に対応し、ループ・再帰・浮動小数点・配列・文字列を含む関数は `unsupported` として報告されます。

---

## 属性リファレンス一覧

Tsuzuri で使用可能な全 16 属性と、同じく `@` で始まる関連記法の一覧です。

### 組み込み属性（全 16 個）

| 属性 | 配置位置 | 役割と効果 | 主な関連診断 |
| --- | --- | --- | --- |
| `@checked` | 式、または対応する文の直前 | 直下の整数 `+`・`-`・`*`・`**`・単項 `-` の桁あふれで `OverflowException` を送出 | `E0002`, `E1026` |
| `@literal` | `[private] def` の前後 | `const` と等価なコンパイル時定数を `def` 構文で宣言 | `E0002`, `E1026` |
| `@cpu [...]` | トップレベル `def` の前（`private` / `export` より前） | x86_64 / AArch64 の拡張命令セット別に関数の複数版を生成し実行時に自動選択 | `E0002`, `E1005` |
| `@no_alloc` | トップレベル `def` の前 | ヒープ確保を行わないことを静的に検証（生成コードは不変） | `E1031`, `E1032`, `W1008` |
| `@no_copy` | トップレベル `def` の前 | 要素数に比例する暗黙のディープコピーを行わないことを静的に検証 | `E1031`, `E1032`, `W1008` |
| `@no_trap` | トップレベル `def` の前 | ゼロ除算や未証明の添字アクセスなどの論理トラップがないことを静的に検証 | `E1031`, `E1032`, `W1008` |
| `@terminates` | トップレベル `def` の前 | `while`・再帰・外部待機を含まず構造的に停止することを静的に検証 | `E1031`, `E1032`, `W1008` |
| `@trusted` | `extern` 関数・`extern type`・`extern class`・`extern category` の前 | 外部宣言の契約を人間が確認した印と効果性質（`pure` 等。関数だけ）の付与 | `E1037`, `W1010` |
| `@link("name")`・`@link(framework = "name")` | 明示のリンク名を持つ `extern` 関数・C データシンボルの前 | そのシンボルに到達したネイティブのリンクへ、`@link("name")` は `-l<name>` を（macOS でも同じ）、`@link(framework = "name")` は macOS の `-framework <name>` を追加 | `E0002`, `E2000` |
| `@weak` | 明示のリンク名を持つ `extern` 関数、C データシンボル、`extern class`（実行時名の文字列は省略可）の前（Apple ターゲット） | Mach-O の weak import にし、実行環境にシンボルがなければ使用の時点で検査 | `E0002`, `E1008`, `E1037` |
| `@returns_retained`・`@returns_not_retained` | `extern` 関数・`extern class` のメンバーの前 | Objective-C の物体の結果を +1（所有を受け取る）・+0（受け取った後に retain する）として扱う | `E0002`, `E1008` |
| `@count(pos, ty)` | `extern` 関数の前 | バッファ引数に付随して C 側へ渡す長さ引数の整数型（または `none`）を指定 | `E0002`, `E1008` |
| `@c_layout` | `record` 宣言の前 | フィールドを宣言順・C 標準アライメント（または `pack = N`）で配置 | `E0002`, `E1008` |
| `@json "name"` | `record` フィールド・`union` ケースの前 | `deriving (Encode, Decode)` が入出力する JSON キー名・タグ名を変更 | `E0002`, `E1025` |
| `@alias name` | `.tc` ファイルのトップレベル独立行 | コンピュテーション式ビルダーに小文字始まりの別名（`name { ... }`）を追加 | `E0002`, `E1018` |

### 属性ではない `@` 記法と未定義属性の扱い

| 記法 | 分類 | 説明 |
| --- | --- | --- |
| `@requires` / `@ensures` / `@old` | 契約行 | トップレベル関数本体の先頭に置く契約指定（前節参照） |
| `@'a : Eq` | 型クラス制約行 | `def` シグネチャの次行に深くインデントして書く型パラメータ制約（[型クラスと制約](../types/type-classes.md)） |
| `/// @deprecated 理由` | ドキュメントタグ | 公開 `def`・`record`・`union` のドキュメントコメント内に記述。依存先パッケージからの参照時に非推奨警告 `W1005` を出力（`@deprecated def` のような属性構文は存在せず `E0002`） |
| `@inline` 等 | 存在しない属性 | Tsuzuri に `@inline` 属性やユーザー定義デコレータは存在せず、記述すると `E0002` になる（インライン展開は LLVM バックエンドが自動判断する） |

---

## 算術・定数・CPU ディスパッチ属性

### @checked（オーバーフロー検査付き算術）

式または対応する文（`let`、`use`、コンピュテーション式の `let!` / `do!` / `return` / `yield`）の直前に置き、その式が直接評価する組み込み整数演算（`+`、`-`、`*`、`**`、単項 `-`）のオーバーフローを `OverflowException` に変えます。

```tsuzuri run=overflow
def add_i8 :: i8 -> i8 -> string = \a b ->
    let res =
        try
            @checked (a + b)
        with
        | e is OverflowException -> e
    match res with
    | Ok n -> to_string n
    | Error _ -> "overflow"

add_i8 100i8 50i8
```

`/` と `%` のゼロ除算や `MIN / -1` は `@checked` の対象外であり、常に言語トラップとなります。また `let rec` 束縛自体や `const def` の内部に `@checked` を置くことはできません（`E0002` / `E1026`）。

### @literal（コンパイル時定数関数記法）

`def` 構文に `@literal` を付けると、`const` 宣言と同一のコンパイル時定数になります。`private` は `@literal` の前後のどちらにも置けます（ループ等を伴うコンパイル時関数は `@literal` ではなく `const def` を使います）。

```tsuzuri run=300
@literal
private def MaxItems :: i64 = 150

MaxItems * 2
```

### @cpu（命令セット別マルチバージョニング）

トップレベル `def` の前に `@cpu ["ターゲット名", ...]` を置くと、ポータブルな基準版に加えて各拡張命令セット向けに最適化された機械語版を同一バイナリ内に出力し、実行時の初回呼び出しで実行環境が対応する最適な版を自動選択します。

```tsuzuri run=84
@cpu ["avx2", "sse4.2"]
def scale_sum :: [i64] -> i64 = \xs ->
    Array.sum xs * 2

scale_sum [10, 12, 20]
```

- 指定可能なターゲット文字列リテラルは x86_64 向けの `"sse4.2"`・`"avx2"`・`"avx512"`、および AArch64 向けの `"sve"`・`"sve2"` の 5 種類です（未知の名前・空配列・重複は `E0002`）。
- 現在のビルドターゲットに該当しない命令セット名（例: macOS Arm64 ビルド時の `"avx2"`）や WebAssembly ターゲットではエラーにならず無視され、基準版のみが使われます。
- `@cpu` 関数の引数および戻り値（内部フィールドを含む）には ABI 互換性のため 256 ビット SIMD ベクトル型（`i32x8`、`f64x4` など）を含めることはできません（`E1005`）。128 ビットベクトルやスライス参照を使用します。

---

## 静的効果表明（@no_alloc・@no_copy・@no_trap・@terminates）

これら 4 つの属性は、関数本体およびそこから推移的に呼び出されるすべての処理が「特定の効果を起こさないこと」をコンパイラに静的検証させます。生成される機械語は属性の有無で一切変化しません。違反が見つかると、原因となった式と呼び出し経路を添えて `E1031` が報告されます。

```tsuzuri run=1026
@no_alloc
@no_trap
@terminates
def rolling_hash :: [i64] -> i64 = \values ->
    let mut h = 0
    for i in 0 ..< values.length do
        h = h * 31 + values[i]
    h

rolling_hash [1, 2, 3]
```

上記の `values[i]` は `0 ..< values.length` の範囲ループ内にあるため、コンパイラによって境界内であることが静的に証明され、`@no_trap` を通過します。

### 各効果の判定基準

| 属性 | 禁止される操作（検出されると `E1031`） | 許可される主な操作 |
| --- | --- | --- |
| `@no_alloc` | `new`、`Array.init`、環境確保を伴うクロージャ生成・部分適用、文字列連結・補間、再帰共用体構築、64 KiB 超のリテラル、暗黙コピー、`tzroutine` 起動、無印 `extern` | 既存バッファへの書き込み、64 KiB 以下でその場読み取りのみのリテラル、スカラー演算 |
| `@no_copy` | 配列 `[T]` やリスト `[\|T\|]` を含む値の要素数比例の暗黙ディープコピー（`W1006` 相当箇所） | `ref` による借用、`Array.copy` / `List.copy` による**明示的**コピー（ただし `alloc` には該当） |
| `@no_trap` | 0 または `-1` でないリテラル以外の整数除算、未証明の添字・スライス、非リテラル刻みの `for`、`@checked`、`assert`、`Array.get` 等のトラップしうる関数、無印 `extern` | `0 ..< xs.length` や明示的な `if 0 <= i && i < xs.length` 分岐内の配列添字、`Array.try_item`、網羅された `match` |
| `@terminates` | `while` ループ、直接・相互再帰、チャネル・ロック・ネットワーク `accept` 等の外部事象待機、無印 `extern` | 整数範囲 `for`、配列・リスト・`Vec`・文字列に対する有界な `for x in`、`IO.writeln` |

高階関数に効果属性を付けた場合、引数として受け取ったコールバック関数の効果は**呼び出し箇所**で検査されます。そのため、コールバック引数を呼ぶ効果属性付き関数を未適用の関数値としてレコードに格納したり返却したりすると、呼び出し側を追跡できなくなるため `E1031`（`effect_unknown_callee`）で拒否されます。また、一度も実体化されないジェネリック関数や `const def` に付けた場合は `W1008` で通知されます。

---

## FFI・レイアウト・JSON・ビルダー別名属性

### @trusted・@count・@c_layout・@link・@weak（ネイティブ連携）

C ABI やホスト環境との相互運用では、以下の属性を組み合わせて安全性とメモリ配置を制御します（詳細は[ネイティブ相互運用](../compiler/native-interop.md)を参照）。

```tsuzuri
@c_layout(pack = 1)
record PacketHeader { tag: i8u, length: i32u }

@trusted pure no_alloc no_trap terminates
@count(1, i32)
extern "crc32_buf" def c_crc32 :: ref [i8u] -> i32u
```

- **`@trusted [性質...]`**: `extern` 関数または `extern type` の直前に置き、C 側の実装契約を人間が監査済みであることを記録します（未付与の `extern` は `--warn untrusted-extern` や `tsuzuri audit` で `W1010` の対象になります）。同じ行に `pure`・`no_alloc`・`no_copy`・`no_trap`・`terminates` を列挙すると、対応する `pure def` や効果表明付き関数からの呼び出しが許可されます（配置や性質名の誤りは `E1037`）。
- **`@link("名前")` / `@link(framework = "名前")`**: 明示のリンク名を持つ `extern "symbol" def` または C データシンボル（`extern "symbol" view def`）の直前に 1 つ置きます。そのシンボルが最終の出力に到達したときだけ、Tsuzuri が行うネイティブのリンクに、`@link("名前")` は `-l<名前>` を（macOS でも同じ）、`@link(framework = "名前")` は macOS の `-framework <名前>` を追加します。`-l`・`--framework` と重なる名前は 1 つにまとまります。書式の誤りは `E0002`（`link_attribute_syntax`）、ほかの宣言の前は `E0002`（`misplaced_link_attribute`）、`framework` の形に macOS 以外のネイティブターゲットで到達すると `E2000`（`link_framework_target`）、WebAssembly のビルドで到達すると `E2000`（`link_attribute_wasm`）です。
- **`@weak`**: Apple ターゲット（macOS Arm64）で、明示のリンク名を持つ `extern "symbol" def`、`Maybe` を返す C データシンボル、`extern class` の直前に置き、シンボルを Mach-O の weak import にします。`extern class` は実行時名の文字列を省略でき、そのときは型名がクラスの名前です。実行環境にシンボルがないとき、関数の呼び出しとクラスの参照は `the weak symbol '<sym>' is not available on this system` を報告してトラップし、データシンボルの読み出しは `None` を返します。引数を書くと `E0002`（`weak_attribute_syntax`）、ほかの宣言の前は `E0002`（`misplaced_weak_attribute`）、リンク名のない `extern` 関数は `E1008`（`weak_needs_symbol`）、`Maybe` を返さないデータシンボルは `E1008`（`weak_data_symbol_result`）、`@trusted no_trap` との併用は `E1037`（`trusted_no_trap_weak`）です。Apple 以外のネイティブターゲットで到達すると `E1008`（`abi_apple_only`）、WebAssembly では `E1008`（`abi_native_only`）です（[Objective-C 連携](../compiler/objective-c.md)）。
- **`@returns_retained`・`@returns_not_retained`**: Objective-C の物体を返す `extern` 関数、または `extern class`・`extern category` のメンバーの直前に置き、結果の所有を指定します。`@returns_retained` は呼び出し側が所有を受け取る +1 の結果（C の `NS_RETURNS_RETAINED`）、`@returns_not_retained` は受け取った直後に retain する +0 の結果です（`extern` 関数の既定は +0、メンバーの既定は Cocoa の族の規則）。両方を書くか 2 度書くと `E0002`（`returns_retained_conflict`）、ほかの宣言の前は `E0002`（`misplaced_returns_retained_attribute`）、結果が物体でないと `E1008`（`objc_returns_retained_not_object`）です（[Objective-C 連携](../compiler/objective-c.md)）。
- **`@count(位置, 型)`**: `extern` 関数の 1 始まり引数位置にあるバッファ引数（`ref [T]`、`ref mut [T..]`、`ref string`、`ref utf8string`）に対し、C 関数へ渡す要素数引数の型を `i32`・`i32u`・`i64`（既定）・`i64u`、または省略の `none` から指定します（誤りは `E1008` / `E0002`）。
- **`@c_layout` / `@c_layout(pack = N)`**: `record` 宣言の直前に置き、フィールドを宣言順かつ C 標準アライメント（`pack = N` では `1`・`2`・`4`・`8`・`16` バイト上限）で配置します。`string` や `bool`、型パラメータを含むレコードには指定できません（`E1008`）。

### @json（JSON シリアライズ名のカスタマイズ）

`deriving (Encode, Decode)` を持つレコードのフィールドや共用体のケースの前に `@json "キー名"` を置くと、Tsuzuri 上の識別子を変えずに JSON 入出力時のキー名・タグ名だけを変更できます（`Encode` / `Decode` の導出がない型や名前の重複は `E1025`）。

```tsuzuri run=%7B%22user_id%22%3A7%2C%22name%22%3A%22Ann%22%7D%20%22done%22
record User { @json "user_id" id: i64, name: string } deriving (Encode, Decode)
union JobState = Queued | @json "done" Completed deriving (Encode, Decode)

let u = User { id: 7, name: "Ann" }
let u_json = Result.get (Json.serialize (ref u))
let s_json = Result.get (Json.serialize (ref Completed))

$"{String.from_utf8 (ref u_json)} {String.from_utf8 (ref s_json)}"
```

### @alias（コンピュテーション式ビルダーの小文字別名）

コンピュテーション式ビルダーを定義する `.tc` ファイルのトップレベルに `@alias 小文字名` を記述すると、モジュール名 `Builder { ... }` に加えて `小文字名 { ... }` でも同じビルダーを呼び出せます（`.tz` や `.tt` に置くと `E1018`）。実例と名前解決規則は[コンピュテーション式](./computation-expressions.md)を参照してください。

## 関連項目

- [関数](./functions.md)
- [演算子と式](./operators.md)
- [束縛と値](./bindings-and-values.md)
- [コンピュテーション式](./computation-expressions.md)
- [エラー処理と例外](./error-handling.md)
- [リソース管理とアサーション](./resources-and-assertions.md)
- [型クラスと制約](../types/type-classes.md)
- [ドキュメントコメント](../modules/doc-comments.md)
- [Json](../stdlib/encoding/json.md)
- [Gen](../stdlib/testing/gen.md)
- [ネイティブ相互運用](../compiler/native-interop.md)
- [診断コード一覧](../compiler/diagnostics.md)
