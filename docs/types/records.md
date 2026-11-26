# レコード

レコード（`record`）は、名前付きフィールドを持つ名目的（nominal）な複合値型です。座標・設定・ドメインエンティティのように各要素の役割が明確な構造化データを表すために使用します。オブジェクト指向言語のクラスとは異なり継承や仮想メソッドは持たず、不変データの関数型更新 `{ r with field = val }` と、可変束縛・排他参照を通じたフィールド単位の直接更新および排他借用 `ref mut r.field` の双方を安全にサポートします。

## 要点

- **名目的型付けと必須の型注釈**: フィールド構成が同じでも宣言が異なれば別の型として区別されます。すべてのフィールドに型注釈が必須であり、構築時は全フィールドを 1 回ずつ指定します。
- **関数型更新と部分ムーブ**: `{ r with x = 10 }` は新しいレコードを構築します（非 `Copy` レコードでは元の `r` を消費）。非 `Copy` フィールドはフィールド単位で部分ムーブ可能です。
- **フィールド代入と排他借用（Edition 2027+）**: 可変所有者や `ref mut` 引数を起点として、`r.x = 10` の直接代入や、互いに素なフィールドの同時排他借用 `ref mut r.x`・`ref mut r.xs[1..]` が可能です。
- **参照フィールドとリージョン推論**: 共有参照フィールドや、名前付きリージョン `{r s}` による複数借用の独立追跡・排他借用フィールド（`ref mut {r} T`）を記述できます。
- **メモリ最適化と `@c_layout`**: 通常レコードはパディング削減のためフィールドをアライメント降順で格納し（上限 64 KiB、`E1010`）、C 構造体と厳密一致させる場合は `@c_layout` / `@c_layout(pack = N)` を指定します。
- **自動導出と `@json`**: `deriving (Eq, Ord, Display, Hash, Default, Arbitrary, Encode, Decode)` およびフィールド属性 `@json "name"` に対応します。

## レコードの宣言・リテラル構築・フィールドアクセス

### 宣言と構築構文

```text
[private] record Name { field1: Type1, field2: Type2 }
[private] record Name<'a, const N: i64> {r} { field1: 'a, view: ref {r} [i64; N] }
```

レコード名は ASCII 英大文字で始めます。各フィールドの型注釈は省略できません（省略すると `E0002`）。`private record` を指定すると同一モジュール内でのみ構築・フィールド参照が可能になり、公開関数のシグネチャや公開型のフィールドに露出させると `E1022` エラーになります。

リテラル構築 `Name { field1: v1, field2: v2 }` では、宣言された全フィールドをカンマ区切りでちょうど 1 回ずつ指定します。記述順は宣言順と異なっていても構いませんが、評価はリテラルに記述した順序（左から右）で行われます。

- 同一フィールドの重複指定は `E1001`、未知のフィールドまたは不足フィールドは `E1007`、型の不一致は `E1003` です。`{ x }` のようなフィールド名省略記法はありません。

```tsuzuri run=42
record Point { x: i64, y: i64 }

def manhattan :: Point -> i64 = \p -> Int.abs p.x + Int.abs p.y

let origin_shift = Point { y: -22, x: 20 }
let Point { x = px, y = py } = origin_shift
(manhattan origin_shift + px + py) + 2
```

### フィールドアクセスとパターン分解

- **ドット記法**: `point.x` でフィールドを読み出します。受け手が共有参照 `ref Point` や排他参照 `ref mut Point`（Edition 2027+ の読み取り引数を含む）であっても自動的に参照外しが行われます。
- **パターン分解**: 不変束縛 `let Point { x = a, y = b } = p`（コロン `Point { x: a }` も可）や `match` 式では、必要な一部のフィールドのみを指定して分解できます。検査対象の型がすでに `Point` と確定している場合はレコード名を省略した `{ x = a }` パターンも記述できます。

## 関数型レコード更新と部分ムーブ

### `{ r with ... }` による関数型更新

既存のレコード値を基に一部のフィールドだけを置き換えた**新しいレコード値**を作るには、`with` 更新式を使用します（フィールド結合子は `=` または `:`、区切りは `,` または `;`）。元の式を 1 回評価したのち、置換式を左から右へ評価して新しいレコードを組み立てます。

```tsuzuri run=60
record Point { x: i64, y: i64 }

let p1 = Point { x: 20, y: 22 }
let p2 = { p1 with x = 40 }
p1.x + p2.x
```

- **Copy 条件と所有権消費**: 再帰しておらず、利用者定義の [`Drop`](../ownership/drop.md) を持たず、全フィールドが `Copy` であればレコード全体も自動的に `Copy` となるため、上の `p1` は更新後も使用できます。一方、`string` や `Vec` などの非 `Copy` フィールドを 1 つでも含むレコードでは、`{ r with ... }` が元の `r` の所有権を消費します。そのため、更新後や置換式の内部で元の `r` を参照すると `E1012` エラーになります（必要な値は更新式の前にあらかじめ取り出しておきます）。
- **更新構文の制限**: 空の `{ r with }` は構文エラー `E0002`、同一フィールドの重複指定は `E1001`、`Drop` を実装したレコードへの適用および非 `Copy` レコードの共有参照外しに対する適用は `E1012` になります。

```tsuzuri run=10
record Label { text: string, count: i64 }

let label = Label { text: "order", count: 1 }
let current_len = label.text.length
let updated = { label with count = current_len }
updated.count + updated.text.length
```

### フィールド単位の部分ムーブ

`Drop` を実装していないレコードからは、特定の非 `Copy` フィールドだけを取り出してムーブできます。ムーブされていない残りのフィールドは引き続き読み取り・ムーブが可能であり、スコープ終了時には未ムーブのフィールドのみが解放されます。部分ムーブ後にレコード全体を使用したり、ムーブ済みフィールドへ再代入したりすると `E1012` エラーになります。

```tsuzuri run=7
record Entry { name: string, score: i64 }

let entry = Entry { name: "alice", score: 2 }
let extracted_name = entry.name
extracted_name.length + entry.score
```

## フィールド代入とフィールド排他借用 `ref mut r.field`（Edition 2027+）

Edition 2027 以降（既定の Edition 2028 を含む）では、可変ローカル所有者 `let mut r`、可変値ビュー引数 `mut R`、排他参照引数 `ref mut R`、または `Mutex.with_lock` コールバック引数などを根（ルート）とするレコードフィールドの直接更新と排他借用がサポートされます（Edition 2026 では `E1012` / `E1014` となります）。

### フィールドへの直接代入

右辺の評価 → 代入先の特定 → 古いフィールド値の `drop` → 新しい値の格納、の順でその場で書き換えます。入れ子のレコードフィールドや `IndexMut` を実装したフィールドへの `holder.grid[1] = 42` のような添字代入も可能です。

```tsuzuri run=42
record Counter { count: i64, step: i64 }

let mut c = Counter { count: 2, step: 20 }
c.count = c.count + c.step * 2
c.count
```

### 互いに素なフィールドの排他借用（`ref mut r.field`）

借用チェッカーはレコードのフィールドパス（`b.n`、`o.inner.xs` など）を個別に追跡します。そのため、あるフィールドを `ref mut b.n` として排他借用している間でも、**それと重ならない別フィールド**に対して共有借用 `ref b.xs` や排他スライス借用 `ref mut b.xs[1..]` を同時に取得して関数へ渡すことができます。

```tsuzuri run=135
record Bucket { total: i64, items: [i64] }

def add_slice_sum :: ref mut i64 -> ref [i64] -> unit = \acc xs ->
    deref acc = deref acc + Array.sum xs

let mut b = Bucket { total: 5, items: [10, 20, 30] }
let tail = ref mut b.items[1..]
Array.write 0 90 tail
add_slice_sum (ref mut b.total) (ref b.items)
b.total
```

フィールド排他借用に関する境界条件は以下のとおりです。

- **重なるパスの競合検査**: 同一フィールドの二重排他借用（`ref mut b.n` と `ref mut b.n`）、親と子の同時借用（`ref mut o.inner` と `ref o.inner.xs`）、およびフィールド借用が生存中のレコード全体の読み取り・再代入はすべて借用競合エラー **`E1014`**（`borrow_conflict`）として静的に阻止されます。
- **排他借用できない起点**: 配列要素を経由するパス（`ref mut arr[0].n`）、不変束縛 `let b`、クロージャが環境捕捉した変数、`match` パターン内の読み取り専用ビュー、共有参照 `ref B` からの排他借用はすべて **`E1014`**（`mutate_immutable_value`）になります。関数呼び出しの一時値に対する `ref mut (make ()).n` は **`E1013`**（`borrow_of_temporary`）、不透明な標準ライブラリ型フィールドへの直接アクセスは **`E1022`**、`Drop.drop` 実装内での自己書き換えは **`E1012`** です。

## 参照フィールドと名前付きリージョン

### 共有参照フィールドと自動寿命追跡

レコードのフィールドには `ref T` の共有参照を格納できます。借用を含むレコードは元の所有者の生存期間を引き継ぎ、所有者がスコープを抜けた後の参照や `tzroutine` への送信は `E1013` として拒否されます。

複数の参照フィールドの寿命を独立に追跡したい場合は、レコード名の直後に最大 16 個までの**名前付きリージョン** `{r s}`（17 個以上は `E1017`）を宣言します。

```tsuzuri run=7
record PairView {r s} { left: ref {r} string, right: ref {s} string }

def take_left {r s} :: PairView {r s} -> ref {r} string = \pair -> pair.left

let long_lived = "abcdefg"
let kept = {
    let short_lived = "xy";
    let pv = PairView { left: ref long_lived, right: ref short_lived };
    take_left pv
}
kept.length
```

`take_left` の戻り値リージョンは `{r}` のみであるため、内側のブロックで `short_lived` の寿命が尽きても `long_lived` 由来の参照 `kept` を安全に外へ取り出せます。

### 排他参照フィールド（`ref mut {r} T`）

レコードのフィールドに排他借用を持たせる場合は、必ず名前付きリージョンを伴う `ref mut {r} T` として宣言します（リージョンなしの `record Bad { v: ref mut i64 }` や、ジェネリック型引数への `Holder<ref mut i64>` の具体化は `E1013` になります）。

```tsuzuri run=15
record MutCounter {r} { value: ref mut {r} i64, step: i64 }

def advance :: ref mut MutCounter -> unit = \c ->
    deref c.value = deref c.value + c.step

let mut total = 5
let mut counter = MutCounter { value: ref mut total, step: 5 }
advance (ref mut counter)
advance (ref mut counter)
total
```

リージョン記法と再借用規則の詳細は[ライフタイムとリージョン](../ownership/lifetimes.md)を参照してください。

## メモリレイアウト上限（64 KiB）と `@c_layout`

### 通常のフィールド配置とサイズ上限

通常のユーザー定義レコードは、パディングによるメモリ浪費を抑えるため、サイズ縮小効果がある場合に限り**フィールドをアライメントの大きい順（同アライメント内は宣言順）に自動並べ替え**して格納します。たとえば `Mixed { flag: bool, count: i64, tag: i8, ratio: f64 }` は宣言順なら 32 バイトですが、内部格納順が `count, ratio, flag, tag` となることで 24 バイトに収まります。この最適化は格納オフセットのみを変更し、リテラル評価順・`Drop` 解放順・`deriving` の比較や JSON 出力順・デバッグ情報は宣言順のまま保たれます。

- **64 KiB 上限**: レコード単体の保守的インラインレイアウトサイズが **64 KiB** を超えると `E1010` エラーになります（可変長配列 `[T]` や `string` のヒープバッファ本体はこの上限に含まれません）。
- **自己再帰の禁止**: 共用体や参照カウントポインタを介さないレコード同士の直接循環（`record Node { next: Node }`）は無限サイズとなるため `E1010` になります。木や連結構造には [`Maybe`](../stdlib/core/maybe.md) / [`union`](unions.md) または [`Rc` / `Arc`](../stdlib/memory/rc.md)、循環グラフには [`Arena`](../stdlib/memory/arena.md) を使用します。

### C 構造体互換レイアウト（`@c_layout`）

C API や Win32 API の構造体とバイト単位で一致するメモリ配置が必要な場合（Rust の `#[repr(C)]` や `#pragma pack(N)` に相当）、`record` 宣言の直前に `@c_layout` または `@c_layout(pack = N)`（`N` は `1`・`2`・`4`・`8`・`16`）を付与します。

```tsuzuri run=30
@c_layout
record CPoint { x: i32, y: i32 }

@c_layout(pack = 1)
record PacketHeader { kind: i8u, payload_len: i32u }

let pt = CPoint { x: 10, y: 20 }
let hdr = PacketHeader { kind: 1i8u, payload_len: 20i32u }
(pt.x + pt.y) as i64 + hdr.payload_len as i64 - 20
```

`@c_layout` レコードの仕様と制約は以下のとおりです。

- フィールドは並べ替えを行わず宣言順に C 標準アライメント（`pack = N` 指定時は最大アライメント `N`）で配置され、`tsuzuri build --emit header` では `#pragma pack` とサイズ・オフセット検証用の `_Static_assert` を含む C 構造体定義が出力されます。
- 許可されるフィールド型は、固定幅数値（`i8`〜`i128`、`i8u`〜`i128u`、`f16`〜`f128`、`d32`〜`d128`）、数値の固定長配列 `[T; N]`（`N >= 1`）、入れ子の `@c_layout` レコード、`extern type copy` ハンドル、`Maybe<Handle>`、`FnPtr<F>`、および入力専用の `ref ZString` / `Maybe<ref ZString>` です。
- `bool` フィールドは C の `_Bool`（1 B）と Win32 `BOOL`（4 B）の差異による ABI 事故を防ぐため `E1008` で拒否されます（`i8u` または `i32` を明示します）。また、空レコード、ジェネリック型パラメータ、リージョン、`Drop` 実装を持つレコードに `@c_layout` を付けることもできません（`E1008`）。詳細は[ネイティブ連携](../compiler/native-interop.md)を参照してください。

## 自動導出 `deriving` と `@json` 属性

レコード宣言の末尾に `deriving (...)` を記述すると、フィールドの宣言順に基づいた型クラスインスタンスが自動生成されます。導出可能なクラスは **`Eq`・`Ord`・`Display`・`Hash`・`Default`・`Arbitrary`・`Encode`・`Decode`** の 8 種類です（`Ord` を導出する場合は `Eq` も同時に導出または実装している必要があり、欠落時は `E1025` となります）。

さらに、`Encode` / `Decode` を導出するレコードではフィールドの直前に `@json "キー名"` 属性を付けることで、Tsuzuri 上のフィールド名を変えずに JSON / CBOR オブジェクトのキー名を変更できます（`Encode`・`Decode` のいずれも導出していない場合や、複数フィールドの JSON キー名が衝突する場合は `E1025`）。

```tsuzuri run=%7B%22user_id%22%3A7%2C%22name%22%3A%22Ann%22%7D%20true
record User {
    @json "user_id" id: i64,
    name: string
} deriving (Eq, Ord, Display, Hash, Default, Encode, Decode)

let u = User { id: 7, name: "Ann" }
let raw = Json.serialize (ref u) |> Result.get
let decoded: User = Json.deserialize (ref raw) |> Result.get
$"{String.from_utf8 (ref raw)} {decoded == u}"
```

## モジュールと同名のレコード・名前空間修飾規則

Tsuzuri は「1 ファイル = 1 モジュール」の構成を採っており、モジュールと同名のレコードを宣言した場合は特別な短縮解決規則が働きます。

- **モジュールと同名のレコード**: `Point.tz` 内で `record Point { ... }` を宣言した場合、他モジュールから見たその型の正規名は `Point`（名前空間付きパッケージでは `Geo::Point`）になります。**`Point.Point` のようにモジュール名と型名を重ねて書くことはできず**、`E1004` エラーになります。
- **モジュールと別名のレコード**: `Shapes.tz` 内で `record Rect { ... }` を宣言した場合は、`Shapes.Rect`（名前空間付きなら `Geo::Shapes.Rect`）またはプロジェクト内で一意なら無修飾の `Rect` として参照できます。
- **同名型の衝突解決**: 複数のモジュールや名前空間に同名の `Point` が存在して無修飾参照が曖昧になる場合も `E1004` となるため、`Geo::Point` や `Ui::Point` のように `::`（または `Module.Type`）で修飾して一意に指定します。

```tsuzuri project=same-mod-rec file=Point.tz
record Point { x: i64, y: i64 }

def origin :: unit -> Point = \() -> Point { x: 0, y: 0 }
```

```tsuzuri project=same-mod-rec file=Main.tz run=42
let start: Point = Point.origin ()
let target = Point { x: 20, y: 22 }
start.x + target.x + target.y
```

## 関連項目

- [型システムの概要](overview.md)
- [タプル](tuples.md)
- [判別共用体](unions.md)
- [ジェネリクス](generics.md)
- [型クラス](type-classes.md)
- [所有権とムーブ](../ownership/ownership-and-move.md)
- [借用と参照](../ownership/borrowing.md)
- [ライフタイムとリージョン](../ownership/lifetimes.md)
- [メモリレイアウト](../ownership/memory-layout.md)
- [Drop とリソース解放](../ownership/drop.md)
- [契約と属性](../expressions/contracts-and-attributes.md)
- [モジュールと名前空間](../modules/namespaces-and-modules.md)
- [ネイティブ連携](../compiler/native-interop.md)
