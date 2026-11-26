# Arena

`Arena<'a>` は、要素を密な連続領域に保持し、世代付きハンドル `Arena.Handle<'a>` によって各要素を識別する所有コンテナです。有向グラフ、双方向連結リスト、構文木（AST）、キャッシュなどの相互参照・循環構造を、ガベージコレクタや参照カウントに頼らず所有権モデルのまま安全に表現できます。

`Arena` は名前を参照したプログラムにのみ読み込まれるオプトイン標準モジュールであり、型や関数は常に `Arena.Handle` や `Arena.insert` のように修飾名で記述します。

## 要点

- `Arena<'a>` は全ノードの所有権を一括保持する非 `Copy` の不透明型であり、公開フィールドへの直接アクセスや構築は `E1022` で保護されている。
- `Arena.Handle<'a>` はアリーナ ID・スロット番号・世代番号の 3 つの `i64` からなる軽量な `Copy` 値である。ハンドル自体は要素の寿命を延ばさないため、ハンドル同士が循環してもメモリリークは発生しない。
- `Arena.remove` で要素を削除するとスロットの世代番号が進むため、削除前の古いハンドル（ダングリングハンドル）はスロット再利用後も確実に無効と判定される。
- 無効なハンドルに対して `contains` は `false`、`get` は `Maybe.None`、`remove` は無変更のまま `Maybe.None` を返し、`at` と `update` はトラップする。
- アリーナ自体の `Drop` は内部の密な配列を先頭から反復解放するため、深い循環グラフであってもスタックオーバーフローを起こさずに一括解放される。

## 基本的な使い方：循環グラフと双方向リンクの表現

自己参照レコード `record Node { next: Node }` は無限サイズとなるため `E1010` で拒否されますが、`Arena.Handle<Node>` は固定サイズの整数組であるためレコード内に自由に保持できます。循環辺を張る場合は、先にノードを `Arena.insert` で登録してハンドルを取得し、後から `Arena.update` で接続先ハンドルを書き込みます。

```tsuzuri run=forward%3D30%20backward%3D10%20sum%3D60
record DNode {
    value: i64,
    prev: Maybe<Arena.Handle<DNode>>,
    next: Maybe<Arena.Handle<DNode>>,
}

def set_next :: own Arena.Handle<DNode> -> own DNode -> DNode
fn set_next target node =
    DNode { value: node.value, prev: node.prev, next: Maybe.Some target }

def set_prev :: own Arena.Handle<DNode> -> own DNode -> DNode
fn set_prev target node =
    DNode { value: node.value, prev: Maybe.Some target, next: node.next }

def build_and_walk :: unit -> string
fn build_and_walk _ =
    let a0: Arena<DNode> = Arena.with_capacity 4
    match Arena.insert (DNode { value: 10, prev: Maybe.None, next: Maybe.None }) a0 with
    | (a1, h1) ->
        match Arena.insert (DNode { value: 20, prev: Maybe.Some h1, next: Maybe.None }) a1 with
        | (a2, h2) ->
            match Arena.insert (DNode { value: 30, prev: Maybe.Some h2, next: Maybe.None }) a2 with
            | (a3, h3) ->
                let list =
                    a3
                    |> Arena.update h1 (set_next h2)
                    |> Arena.update h2 (set_next h3)
                let second = Maybe.get (Arena.at h1 (ref list)).next
                let third = Maybe.get (Arena.at second (ref list)).next
                let forward = (Arena.at third (ref list)).value
                let back1 = Maybe.get (Arena.at third (ref list)).prev
                let back0 = Maybe.get (Arena.at back1 (ref list)).prev
                let backward = (Arena.at back0 (ref list)).value
                let mut sum = 0
                for (_h, node) in Arena.iter (ref list) do
                    sum = sum + node.value
                $"forward={forward} backward={backward} sum={sum}"

build_and_walk ()
```

引数を持たない `Arena.empty` は 0 引数関数であるため、`Arena.empty()` と記述します（空白を入れた `Arena.empty ()` は `unit` 引数渡しと解釈され `E1006` になります）。

## 引数の順序

`Arena` モジュールは [引数の順序](../conventions.md) の原則に従い、読み取りまたは更新の対象である **`Arena<'a>` を常に最後の引数**に取ります。これにより、`|>` によるパイプライン連鎖や `>>` による部分適用関数の合成をそのまま記述できます。

```tsuzuri run=count%3D1%20val%3D42%20present%3Dtrue
let init: Arena<i64> = Arena.empty()
match init |> Arena.insert 40 with
| (arena, h) ->
    let bump_twice = Arena.update h (\x -> x + 1) >> Arena.update h (\x -> x + 1)
    let updated = arena |> bump_twice
    let val = deref (updated |> Arena.at h)
    let present = updated |> Arena.contains h
    $"count={Arena.length (ref updated)} val={val} present={present}"
```

なお、`Arena.update h f >> Arena.at h` のように一時生成された `Arena` から内部参照 `ref 'a` を返す関数を直接合成すると、一時値の寿命を超える参照返却となるため `E1013` で検出されます。参照を取り出す際は、更新後の `Arena` を一度ローカル束縛に置いてから借用します。

## 世代付きハンドルの安全性とスロット再利用

各スロットは 0 から始まる 64 ビット世代番号を持ち、`Arena.remove` で要素が取り除かれるたびに世代が進みます。空いたスロットは LIFO（後入れ先出し）順で次の `Arena.insert` に再利用されますが、旧ハンドルの世代番号とは一致しないため、削除済み要素への誤参照（ABA 問題）は発生しません。

```tsuzuri run=old_valid%3Dfalse%20new_valid%3Dtrue%20old_lookup%3Dnone
let empty: Arena<string> = Arena.empty()
match Arena.insert "v1" empty with
| (a1, h_old) ->
    match Arena.remove h_old a1 with
    | (a2, _removed) ->
        match Arena.insert "v2" a2 with
        | (a3, h_new) ->
            let old_valid = Arena.contains h_old (ref a3)
            let new_valid = Arena.contains h_new (ref a3)
            let old_lookup =
                match Arena.get h_old (ref a3) with
                | Maybe.Some s -> $"{s}"
                | Maybe.None -> "none"
            $"old_valid={old_valid} new_valid={new_valid} old_lookup={old_lookup}"
```

- **別アリーナの検出**: 各アリーナはプロセス内で原子的に採番される固有 ID を持ちます。異なるアリーナで発行されたハンドルを渡した場合も無効ハンドルとして扱われます。
- **世代番号の上限**: スロットの世代番号が `i64` 最大値（`9223372036854775807`）に達した状態で削除された場合、そのスロットは退役（retire）し以降は再利用されません。トラップや世代の折り返しは起きません。
- **`Eq`・`Ord`・`Hash` の決定性**: `Arena.Handle<'a>` は `Eq`・`Ord`・`Hash` を実装していますが、並行実行時にもコレクションの順序が非決定的にならないよう、比較とハッシュ計算にはスロット番号と世代番号のみを用い、アリーナ ID は含めません。`Map` や `HashMap` のキーとして使う場合は、単一アリーナのハンドルのみを格納するか、識別用の番号とのタプルをキーにしてください。

## 密な配置と反復順序（Swap-Remove）

`Arena` は内部の `Vec<'a>` に要素を隙間なく詰めて保持します。削除が発生するまでは挿入順に並びますが、`Arena.remove` は削除位置に末尾の要素を移動して詰める（swap-remove）ため、計算量 $O(1)$ を維持する代わりに要素の並び順が変化します。

```tsuzuri run=0423
let mut arena: Arena<i64> = Arena.empty()
let mut hs: Vec<Arena.Handle<i64>> = Vec.empty()
for v in 0i64 ..= 4 do
    match Arena.insert v arena with
    | (next, h) ->
        arena = next
        hs = Vec.push_owned h hs
match Arena.remove hs[1] arena with
| (after, _) ->
    let mut out = ""
    for (_h, item) in Arena.iter (ref after) do
        out = out + to_string (deref item)
    out
```

## 所有権・借用と並行処理

- `insert`・`remove`・`update` は元の `Arena` を消費して新しい `Arena` を返します。`get`・`at`・`iter` が返した参照が生きている間は `Arena` を消費できません（`E1014`）。
- `'a` が `Send` であれば `Arena<'a>` 自体を `tzroutine` へムーブできます。また `'a` が `Sync` であれば `Routine.scope` を通じて複数の `tzroutine` から `ref Arena<'a>` を同時に読み取れます。`Arena.Handle<'a>` は `'a` によらず常に `Copy`・`Send`・`Sync` です。

```tsuzuri run=99
let a0: Arena<i64> = Arena.empty()
let ch: Channel<i64> = Channel.make 1
match a0 |> Arena.insert 90 with
| (a1, h) ->
    let a2 = a1 |> Arena.update h (\x -> x + 9)
    let tx = Channel.share ch
    tzroutine {
        Channel.send tx (deref (Arena.at h (ref a2)))
    }
    Maybe.default_value 0 (Channel.recv ch)
```

## API リファレンス

`std::Arena` モジュールの全 10 公開関数の一覧です（要素数を $n$ とします）。

### 生成と要素数

| 関数 | 型シグネチャ | 計算量 | 説明 |
| --- | --- | --- | --- |
| `Arena.empty` | `Arena<'a>`（`Arena.empty()` で呼び出し） | $O(1)$ | ヒープ確保を行わず空のアリーナを生成する |
| `Arena.with_capacity` | `own i64 -> Arena<'a>` | $O(1)$ | 指定個数分の内部領域を事前確保した空のアリーナを生成する（負数はトラップ） |
| `Arena.length` | `ref Arena<'a> -> i64` | $O(1)$ | 現在格納されている要素数を返す |

### 検証と参照取得

| 関数 | 型シグネチャ | 計算量 | 説明 |
| --- | --- | --- | --- |
| `Arena.contains` | `own Arena.Handle<'a> -> ref Arena<'a> -> bool` | $O(1)$ | ハンドルがこのアリーナの生存要素を指していれば `true`、無効なら `false` |
| `Arena.get` | `own Arena.Handle<'a> -> ref Arena<'a> -> Maybe<ref 'a>` | $O(1)$ | 有効ハンドルなら要素の共有借用を `Some` で返し、無効なら `None` を返す |
| `Arena.at` | `own Arena.Handle<'a> -> ref Arena<'a> -> ref 'a` | $O(1)$ | 要素の共有借用を直接返す（無効ハンドルの場合はトラップ） |
| `Arena.iter` | `ref Arena<'a> -> Seq<(Arena.Handle<'a> * ref 'a)>` | 全体 $O(n)$ | 密な格納順で `(ハンドル, 要素の共有借用)` を遅延列挙する |

### 挿入・削除・更新

| 関数 | 型シグネチャ | 計算量 | 説明 |
| --- | --- | --- | --- |
| `Arena.insert` | `own 'a -> own Arena<'a> -> (Arena<'a> * Arena.Handle<'a>)` | 償却 $O(1)$ | 要素をアリーナへムーブし、更新後のアリーナと新しいハンドルの組を返す |
| `Arena.remove` | `own Arena.Handle<'a> -> own Arena<'a> -> (Arena<'a> * Maybe<'a>)` | $O(1)$ | 要素を取り出して `Some` で返す（無効ハンドルならアリーナを変えず `None`） |
| `Arena.update` | `own Arena.Handle<'a> -> own ('a -> 'a) -> own Arena<'a> -> Arena<'a>` | $O(1)$ + 関数実行 | 要素を変換関数に通して同じハンドルで置き換える（無効ハンドルは関数を呼ばずトラップ） |

## 関連項目

- [Rc と Arc](./rc.md)
- [Vec](../collections/vec.md)
- [Seq](../collections/seq.md)
- [引数の順序](../conventions.md)
- [所有権とムーブ](../../ownership/ownership-and-move.md)
- [Drop とリソース解放](../../ownership/drop.md)
