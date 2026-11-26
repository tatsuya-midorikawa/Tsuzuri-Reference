# 判別共用体

判別共用体（`union`）は、あらかじめ列挙された名前付きケース（バリアント）のうち、いずれか 1 つだけの値とペイロードを保持する名目的な直和型です。処理結果の成功と失敗、構文木のノード、状態遷移機械の各フェーズのように「互いに排他的な選択肢」を型として表現します。`match` 式による網羅性検査と組み合わさることで、新しいケースを追加した際の分岐漏れをコンパイル時に確実に検出できます。

## 要点

- **0個または1個のペイロード型**: 各ケースのペイロードは省略（0 個）または単一の型（1 個）です。複数の値を持たせる場合はタプル `Rect of f64 * f64` またはレコード 1 つにまとめます。
- **第一級のケース構築子**: ペイロードなしのケースは値、ペイロード付きのケースは 1 引数の関数値（`Some`、`|> Ok` など）として扱えます。
- **ユーザー定義優先の名前解決**: 無修飾ケースや同名型がある場合、自モジュールの宣言が標準ライブラリより優先されます（標準の `Maybe.Some` が隠れた場合は `std::Maybe.Some` で明示します）。
- **コンパイル時の網羅性検査**: `match` 式と関数ガードは全ケースの網羅を検査し、不足しているケースを `E1021` で具体的に提示します。
- **再帰的データ構造と反復解放**: 共用体を経由する再帰型（木や連結リスト）は自動的にヒープノードへ格納され、破棄時はコールスタックを消費しない反復ループで安全に解放されます。

## 判別共用体の宣言とペイロード規則

```text
[private] union Name =
    | Case1
    | Case2 of PayloadType
    | Case3 of TypeA * TypeB

[private] union GenericName<'a, const N: i64> =
    | Empty
    | Chunk of ['a; N]
```

- **命名規則**: パターンマッチにおいて小文字始まりの識別子は束縛変数として解釈されるため、共用体名とすべてのケース名は **ASCII 英大文字**で始める必要があります（小文字始まりは `E1024`）。先頭の `|` は省略可能です。
- **一意性と型パラメータ**: 同一共用体内でのケース名の重複、および共用体名自身と同名のケース宣言（`union Id = Id of i64`）は名前空間の衝突により `E1001` になります（`union Id = IdVal of i64` のように区別します）。宣言した型パラメータ `'a` や長さパラメータ `const N: i64` は少なくとも 1 つのケースのペイロードで使用しなければなりません（未使用・重複は `E1024`）。
- **ペイロードの個数**: `Pair of i64 * i64` のペイロードは「2 個の引数」ではなく「2 要素タプル 1 個」です。構築やパターンでペイロードの有無が宣言と食い違うと `E1020`、ペイロードの型が一致しないと `E1003` になります。
- **列挙型としての利用**: すべてのケースがペイロードを持たない共用体（`union Color = Red | Green | Blue`）は型安全な列挙型として機能します。C 言語の `enum` のような整数値との暗黙変換や `as` キャストはありません。
- **可視性**: `private union` と宣言すると型と全ケースが自モジュール限定となり、公開関数のシグネチャや公開レコードへ露出させると `E1022` エラーになります。

```tsuzuri run=42
union Measurement =
    | Missing
    | Single of i64
    | Range of i64 * i64

def span_total :: Measurement -> i64 = \m ->
    match m with
    | Missing -> 0
    | Single v -> v
    | Range (low, high) -> low + high

span_total (Range (20, 22))
```

## ケース構築と修飾名解決（シャドーイング規則）

### 構築子としての関数値利用

ペイロードを持たないケースはそのまま値として評価され、ペイロードを持つケースは `Payload -> Union` 型の第一級関数としてパイプライン `|>` や高階関数（`Array.map Some xs` など）に直接渡せます。

```tsuzuri run=42
let wrap = Some
let first = wrap 20
let second = 22 |> Some
Maybe.default_value 0 first + Maybe.default_value 0 second
```

### 修飾記法と同名モジュールの規則

ケースは以下の記法で参照できます。

- 無修飾: `Circle`（候補が一意に定まる場合。複数モジュールの同名ケースが競合する場合は `E1004`）
- 型名修飾（自モジュール内）: `Shape.Circle`
- モジュール修飾・完全修飾: `Module.Case`、`Module.Union.Case`、または名前空間付きの `Geo::Shapes.Circle`

ファイル `Shape.tz` にモジュールと同名の `union Shape` を定義した場合、ケースの修飾名は `Shape.Circle` です。`Shape.Shape.Circle` のようにモジュール名と型名を重ねて記述すると、外部モジュールからは `E1004`、自モジュール内からは `E1002` になります。

```tsuzuri project=shape-mod file=Shape.tz
union Shape = Circle of i64 | Rect of i64 * i64 | Empty

def width :: Shape -> i64 = \s ->
    match s with
    | Circle r -> r * 2
    | Rect (w, _) -> w
    | Empty -> 0
```

```tsuzuri project=shape-mod file=Main.tz run=42
let box = Shape.Rect (32, 10)
Shape.width box + Shape.width (Shape.Circle 5)
```

### ローカル共用体による `Maybe.Some` 等のシャドーイング規則

名前解決では常にユーザー定義の宣言が標準ライブラリ（`std`）よりも優先されます。

1. **同名ケースのシャドーイング**: 自モジュールで `union Choice = Some of i64 | None` を宣言すると、無修飾の `Some` / `None` は `Choice` のケースを指します。標準ライブラリの `Maybe` ケースを作るには `Maybe.Some 22` または `std::Maybe.Some 22` と記述します。
2. **`union Maybe` 自体のシャドーイング**: 自モジュールで `union Maybe = Some of i64 | None` のように**型名自体も `Maybe` として宣言した場合**、`Maybe.Some` も自モジュールの `Maybe` 型に解決されます。この状態で標準ライブラリの `Maybe` 型やケースを指すには、名前空間プレフィックス **`std::Maybe`** / **`std::Maybe.Some`** を明記します。
3. **組み込みモジュール名と同名の共用体**: 自モジュールで `union Mutex = ...` のようにコンパイラ組み込み関数を持つモジュールと同名の共用体を宣言した場合、無修飾の `Mutex.create` は共用体ケース探索となって `E1002` になるため、`std::Mutex.create` と修飾します（なお、`Json`・`Regex`・`Unicode`・`Arena` などの opt-in 標準モジュールのケースは常に `Json.Null` のようにモジュール修飾して記述します）。

```tsuzuri run=42
union Maybe = Some of i64 | None

let local_val: Maybe = Maybe.Some 20
let std_val: std::Maybe<i64> = std::Maybe.Some 22

let left = match local_val with
    | Some n -> n
    | None -> 0

left + Maybe.default_value 0 std_val
```

## `match` による分解と網羅性検査

### 網羅性検査と単一ケース分解

判別共用体の分解には `match` 式または関数ガードを使用します。すべてのケースがカバーされていない場合はコンパイルエラー **`E1021`** となり、不足しているケース名（例: `missing: Empty`）が診断メッセージに明示されます。条件付きの `when` ガード節は偽になり得るため網羅性にはカウントされず、前方の節に完全に覆われた到達不能なアームには警告 **`W1003`** が出力されます。

ケースが 1 つしか存在しない共用体（Newtype パターン）は反駁不可能であるため、`match` を使わずに `let` 束縛やラムダ引数で直接分解できます（2 ケース以上の共用体を `let Some x = ...` のように束縛すると `E1021` になります）。

```tsuzuri run=1080
union UserId = UserIdVal of i64

def unwrap_id :: UserId -> i64 = \(UserIdVal raw) -> raw

let uid = UserIdVal 1000
let UserIdVal n = uid
unwrap_id (UserIdVal 80) + n
```

### 所有権・借用とペイロードの制約

- **Copy 条件とムーブ**: 非再帰で `Drop` を実装しておらず、全ケースのペイロード型が `Copy` であれば共用体全体も `Copy` になります。非 `Copy` ペイロードを持つ所有共用体を `match` で値束縛するとペイロードがムーブされ、元の共用体変数を後で使うと `E1012` になります。共有借用 `ref u`（Edition 2027+ の読み取り引数を含む）に対して `match` した場合は、非 `Copy` ペイロードがアーム内限定の読み取り専用ビューとして安全に束縛されます。
- **ペイロード内の借用制限**: 共用体宣言のケース定義に `Hold of ref i64` や `Hold of ref mut i64` のように直接参照型を記述することはできません（`E1013`）。一方、ジェネリック共用体の型引数として共有借用を渡す形（`Maybe<ref string>`）や、リージョン付きレコードをペイロードに入れる形は許可され、元の所有者の生存期間が追跡されます（排他借用の具体化 `Maybe<ref mut i64>` は `E1013`）。

## 再帰的共用体・メモリ表現・反復解放

### 再帰的な木・リスト構造と自動ボックス化

判別共用体のケースを経由する自己参照・相互参照は、コンパイラによって自動的にヒープ確保ノードへと変換されるため、Rust の `Box<T>` のような間接ポインタ型を手動で挟む必要はありません。

```tsuzuri run=42
union IntTree =
    | Leaf
    | Branch of IntTree * i64 * IntTree

def rec tree_sum :: IntTree -> i64 = \tree ->
    match tree with
    | Leaf -> 0
    | Branch (left, value, right) -> tree_sum left + value + tree_sum right

let sample = Branch (Branch (Leaf, 15, Leaf), 7, Branch (Leaf, 20, Leaf))
tree_sum sample
```

- **有限基底ケースの必須検査**: `union Infinite = Loop of Infinite` のように有限の値を作れる基底ケースが存在しない定義は `E1010` として拒否されます。また、再帰のたびに型引数が変化・膨張する非正則な多相再帰定義（`union NonRegular<'a> = End | Next of NonRegular<['a]>` など）は `E1017` になります。
- **スタックを消費しない反復解放**: 再帰的な具体型は非 `Copy` となります。スコープ終了時の自動解放（`Drop` 実装を含む）およびクロージャ捕捉時のディープコピーは、**追加のヒープ確保もコールスタック消費も伴わない反復走査アルゴリズム**で実行されます。そのため、100 万段の深い連結構造であっても解放時にスタックオーバーフローを起こしません（ただし、ユーザー定義の非末尾再帰関数や `deriving` で生成された `Eq`・`Ord`・`Hash`・`Display` の走査自体は通常の再帰呼び出しを行うため、極端に深い構造では明示的なループで走査します）。

### メモリレイアウトとタグ省略（ニッチ最適化）

非再帰の共用体は、ケース番号を表すタグ（256 ケース以下は 1 B、65,536 ケース以下は 2 B、それ以上は 4 B）と、最大ペイロードを収容する共有領域（最大 16 B アライメント）で構成されます。単一値の保守的上限は 64 KiB（`E1010`）です。

さらに、**2 ケース（ペイロードなし 1 個 + ペイロードあり 1 個）の非再帰・非 `Drop` 共用体**では、以下のニッチ最適化によりタグ領域自体が消去されます。

| 共用体の形 | 64-bit ネイティブでのサイズ | タグ省略の仕組み |
| --- | --- | --- |
| `Color = Red \| Green \| Blue` | 1 B | ペイロードなし（1 B タグのみ） |
| `Maybe<i64>` | 16 B | 1 B タグ + 7 B パディング + 8 B 整数 |
| `Maybe<string>` / `Maybe<[i64]>` | **16 B**（タグなし） | 記述子内の長さが `-1` の状態を `None` として表現 |
| `Maybe<i64 -> i64>` | **16 B**（wasm32 は 8 B） | 関数記述子ポインタが null の状態を `None` として表現 |
| `Maybe<ref i64>` / `Maybe<ExternHandle>` | **8 B**（WASM ではタグ付き） | ポインタが null の状態を `None` として表現 |
| `Result<i64, string>` | 24 B | 1 B タグ + 7 B パディング + 16 B 共有ペイロード領域 |

なお、判別共用体は `export def` / `extern def` の C ABI シグネチャには直接指定できません（`E1008`。ネイティブ `extern` における外部ハンドルの `Maybe<Handle>` のみ例外的に null ポインタ対応として許可されます）。

## 自動導出 `deriving` と `@json` 属性

レコードと同様に **`Eq`・`Ord`・`Display`・`Hash`・`Default`・`Arbitrary`・`Encode`・`Decode`** の 8 クラスを `deriving` で自動導出できます。

- **`Eq` / `Ord`**: `Eq` はケースのタグを比較してからペイロードを比較します。`Ord` はケース名ではなく**宣言順**で大小を判定します（先頭ケースが最小）。
- **`Default` / `Arbitrary`**: `Default` は先頭ケースの既定値を生成します（先頭ケースが自己再帰して有限値を作れない場合は `E1025`）。`Arbitrary` は各ケースを等確率で選択する生成器を作ります（再帰的な共用体は `E1025`）。
- **`Encode` / `Decode` と `@json`**: ペイロードなしのケースは文字列 `"Case"`、ペイロードありのケースは単一キーオブジェクト `{"Case": payload}` として JSON / CBOR へ変換されます。ケースの直前に `@json "別名"` を付与するとシリアライズ上のケース名を変更できます。

```tsuzuri run=%22queued%22%20%7B%22done%22%3A42%7D%20true
union JobState =
    | @json "queued" Waiting
    | @json "done" Finished of i64
    deriving (Eq, Ord, Display, Default, Encode, Decode)

let init_state: JobState = Default.default()
let done_state = Finished 42
let raw1 = Json.serialize (ref init_state) |> Result.get
let raw2 = Json.serialize (ref done_state) |> Result.get
let back: JobState = Json.deserialize (ref raw2) |> Result.get

$"{String.from_utf8 (ref raw1)} {String.from_utf8 (ref raw2)} {init_state < back}"
```

## 関連項目

- [型システムの概要](overview.md)
- [レコード](records.md)
- [匿名共用体](anonymous-unions.md)
- [タプル](tuples.md)
- [パターンマッチング](../expressions/pattern-matching.md)
- [メモリレイアウト](../ownership/memory-layout.md)
- [Drop とリソース解放](../ownership/drop.md)
- [Maybe](../stdlib/core/maybe.md)
- [Result](../stdlib/core/result.md)
- [Json](../stdlib/encoding/json.md)
