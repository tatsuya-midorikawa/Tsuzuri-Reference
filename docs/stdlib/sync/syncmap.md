# SyncMap

`SyncMap<'k, 'v>` は、複数の `tzroutine` から同時に読み書きできる並行ハッシュマップです。内部実装は [`RwMutex`](./rwmutex.md) で保護された [`HashMap`](../collections/hashmap.md) であり、読み取り系の操作は共有読み取りロックの下で並行実行され、更新系の操作は排他書き込みロックの下で原子的に実行されます。

`SyncMap` は名前を参照したプログラムにのみ読み込まれるオプトイン標準モジュールです。

## 要点

- `SyncMap.create ()` で空の並行マップを生成する。キー型 `'k` と値型 `'v` にはともに `Send` 制約が必要である。
- 読み取り系操作（`load`・`with_value`・`length`・`for_each`）は共有読み取りロックを獲得するため、複数の `tzroutine` から同時に実行できる。
- 更新系操作（`store`・`load_or_store`・`delete`）は排他書き込みロックを獲得して 1 タスクずつテーブルを更新する。
- `Copy` な値には値を複製して返す `SyncMap.load` を使い、`string` や配列・レコードなどの非 `Copy` 値（または大きな値）を複製せずに読み取るには共有借用 `ref 'v` をコールバックへ渡す `SyncMap.with_value` を使う。
- 呼び出し元のスコープを超えて複数タスクで共有する場合は [`Arc<SyncMap<'k, 'v>>`](../memory/rc.md) に包んで配布する。

## 基本的な使い方

### 格納・参照・条件付き挿入・削除

`SyncMap.load_or_store` はキーがすでに存在すれば既存の値と `true` の組を返し、存在しなければ渡した値を登録してその値と `false` の組を原子的に返します。複数タスクが同時にキャッシュミスした際の重複登録防止に有用です。

```tsuzuri run=first%3D100%3Afalse%20second%3D100%3Atrue%20after_del%3D1
let table: SyncMap<string, i64> = SyncMap.create ()
let first = SyncMap.load_or_store (ref table) "alpha" 100
let second = SyncMap.load_or_store (ref table) "alpha" 999
SyncMap.store (ref table) "beta" 200
let _removed = SyncMap.delete (ref table) (ref "alpha")
let s1 = match first with | (v, hit) -> $"{v}:{hit}"
let s2 = match second with | (v, hit) -> $"{v}:{hit}"
$"first={s1} second={s2} after_del={SyncMap.length (ref table)}"
```

### 非 `Copy` 値のゼロコピー参照（`with_value`）と全件走査（`for_each`）

`string` やレコードなど `Copy` を実装しない値型 `'v` に対しては `SyncMap.with_value` を使用します。コールバックは読み取りロック下で `ref 'v` を受け取り、計算結果だけをロック外へ返します。

```tsuzuri run=host_len%3D11%20entries%3D3%20char_sum%3D27
let endpoints: SyncMap<i64, string> = SyncMap.create ()
let shared = Arc.new endpoints
let wg = WaitGroup.create ()

for id in 1i64 ..= 3 do
    let m = Arc.share (ref shared)
    WaitGroup.go (ref wg) (Owned.function (\() ->
        SyncMap.store (Arc.get (ref m)) id $"server-{id}"))

WaitGroup.wait (ref wg)

let map_ref = Arc.get (ref shared)
SyncMap.store map_ref 1 "primary-api"

let host_len = Maybe.default_value 0 (SyncMap.with_value map_ref (ref 1) (\s -> String.length s))
let char_acc = Atomic.create 0i64
let acc_ref = ref char_acc
SyncMap.for_each map_ref (\_k v -> {
    let _old = Atomic.fetch_add acc_ref (String.length v);
    ()
})
$"host_len={host_len} entries={SyncMap.length map_ref} char_sum={Atomic.load (ref char_acc)}"
```

## 借用・再入・実装特性に関する注意点

- **`with_value` の戻り値制約**: `SyncMap.with_value` のコールバック戻り値 `'b` は `Send` を満たし、かつ借用を保持しうる型（関数型など）であってはなりません（`E1013`）。またコールバックが受け取った `ref 'v` を別の `Mutex` などへ書き出してロック外へ延命させることも `E1013` で拒否されます（後続の `store` や `delete` によって古い値が解放されるため）。
- **コールバック内からの再入禁止**: `SyncMap.with_value` および `SyncMap.for_each` は内部の `RwMutex` の読み取りロックを保持した状態でコールバックを実行します。そのコールバック内から同一の `SyncMap` に対して更新操作（`store`・`load_or_store`・`delete`）や再度のロック取得を行うと、`RwMutex` の非再入規則によりトラップします。
- **非 `Capture` 値の格納**: `SyncMap.store` は内部で一時セルを用いて所有権を受け渡すため、`Mutex` などの関数値へ直接捕捉できない型（`Send` を満たすもの）も値 `'v` として格納できます。ただしマップ全体を `Arc<SyncMap<'k, 'v>>` や `Routine.scope` で共有する場合は、読み取りロックで複数タスクが同時に参照するため `'k` と `'v` が `Sync` も満たす必要があります。
- **`for_each` の反復順序**: ハッシュマップのバケット順を走査するため、要素の訪問順序は規定されません。

## 引数の順序

`SyncMap` は複数タスクが共有する並行リソースであるため、リソースハンドルの例外分類に属し、すべての操作関数で操作対象のマップ `ref SyncMap<'k, 'v>` を**第1引数**に取ります（`SyncMap.store (ref map) key value`、`SyncMap.load (ref map) (ref key)`）。詳細は [引数の順序](../conventions.md) を参照してください。

## API リファレンス

`std::SyncMap` モジュールの全 8 公開関数の一覧です。

### 生成・参照・走査

| 名前 | 種別 / 型シグネチャ | 説明 |
| --- | --- | --- |
| `SyncMap<'k, 'v>` | 型（不透明レコード、非 `Copy`） | `RwMutex<HashMap<'k, 'v>>` による並行ハッシュマップ |
| `SyncMap.create` | `(Send<'k>, Send<'v>) => own unit -> SyncMap<'k, 'v>` | 空の `SyncMap` を生成する |
| `SyncMap.load` | `(Hash<'k>, Eq<'k>, Copy<'v>, Send<'v>) => ref SyncMap<'k, 'v> -> ref 'k -> Maybe<'v>` | キーに対応する値をコピーして `Some` で返す（未登録なら `None`） |
| `SyncMap.with_value` | `(Hash<'k>, Eq<'k>, Send<'b>) => ref SyncMap<'k, 'v> -> ref 'k -> own (ref 'v -> 'b) -> Maybe<'b>` | 読み取りロック下で値への共有借用をコールバックへ渡し、結果を `Some` で返す |
| `SyncMap.length` | `ref SyncMap<'k, 'v> -> i64` | 現在格納されているエントリ数を返す |
| `SyncMap.for_each` | `ref SyncMap<'k, 'v> -> own (ref 'k -> ref 'v -> unit) -> unit` | 読み取りロック下で全エントリのキーと値を走査する（順序未規定、内部からの再入ロックはトラップ） |

### 更新・削除

| 関数 | 型シグネチャ | 説明 |
| --- | --- | --- |
| `SyncMap.store` | `(Hash<'k>, Eq<'k>, Send<'k>, Send<'v>) => ref SyncMap<'k, 'v> -> own 'k -> own 'v -> unit` | キーに値を登録または上書きする |
| `SyncMap.load_or_store` | `(Hash<'k>, Eq<'k>, Copy<'v>, Send<'k>, Send<'v>) => ref SyncMap<'k, 'v> -> own 'k -> own 'v -> ('v * bool)` | 既存値があれば `(既存値, true)` を返し、なければ登録して `(登録値, false)` を返す |
| `SyncMap.delete` | `(Hash<'k>, Eq<'k>) => ref SyncMap<'k, 'v> -> ref 'k -> bool` | キーを削除し、存在していた場合は `true`、未登録だった場合は `false` を返す |

## 関連項目

- [RwMutex](./rwmutex.md)
- [Mutex](./mutex.md)
- [HashMap](../collections/hashmap.md)
- [Rc と Arc](../memory/rc.md)
- [引数の順序](../conventions.md)
