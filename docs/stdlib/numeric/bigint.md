# BigInt

`BigInt`（組み込み型名 `bigint`）は、利用可能なメモリが許す限り任意の桁数を表現できる符号付き多倍長整数型と、その変換・比較関数を提供する標準モジュールです。固定幅の[`Int`](int.md)ではオーバーフローする巨大な整数積、組み合わせ計算、桁数上限の定まらない識別子や金額計算などに用います。

## 要点

- リテラルは `12345678901234567890I`（または `0xFFI`・`0b1010I`）のように接尾辞 `I` を付けて記述します。`bigint` が期待される文脈では接尾辞なしの整数リテラルも自動的に多倍長整数となります。
- `let` 束縛などの型注釈では `bigint` と `BigInt` のどちらも使用できますが、`def` の型シグネチャ `::` 内ではレコード名である `BigInt` を記述します（`:: bigint` は `E1004`）。
- 四則演算（`+`, `-`, `*`, `/`, `%`）・符号反転・累乗（`**`）・等値および順序比較（`==`, `<` 等）・`Display`・`Parse`・`Hash`・`Default` を備えています。
- `BigInt` は `Copy` 型として振る舞いますが、内部表現として $10^9$ 基数の `i64` 桁配列を保持するため、読み取り専用の操作では `ref BigInt` による共有借用が効率的です。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)に従い、変換元の値を受け取る `BigInt.of_i64`・`BigInt.to_i64`・`BigInt.of_string` は対象を最後の引数に取り、`BigInt.compare left right` は比較する 2 つのオペランドを左から右の順で受け取ります。

## 基本的な使い方

```tsuzuri run=doubled%3D19999999999999999999999999999%20q%3D-3%20r%3D-1%20fits%3Dnone
let price = 9999999999999999999999999999I
let doubled = price * 2I + 1I
let q = -7I / 2I
let r = -7I % 2I
let power = 2I ** 100
let fits = match BigInt.to_i64 (ref power) with
    | Some _ -> "some"
    | None -> "none"
$"doubled={doubled} q={q} r={r} fits={fits}"
```

## 組み込み演算子と型クラス実装

演算子はすべて型クラス（`Add`, `Sub`, `Mul`, `Div`, `Rem`, `Pow`, `Neg`, `Eq`, `Ord`）のインスタンスとして実装されており、所有値だけでなく参照オペランド（`(ref a) + (ref b)` 等）にも対応します。

| 演算 / インスタンス | 仕様 | 失敗・トラップ条件 |
| --- | --- | --- |
| `+`, `-`, `*`, 単項 `-` | 任意精度の加減乗算・符号反転 | メモリ確保失敗時のみトラップ |
| `/` | ゼロ方向切り捨て除算（`-7I / 2I == -3I`） | `0I` 除算でトラップ |
| `%` | 被除数と同符号の剰余（`-7I % 2I == -1I`） | `0I` 除算でトラップ |
| `**` | 繰り返し二乗法による累乗（`x ** 0I == 1I`） | 負の指数または指数 $\ge 10^{18}$ でトラップ |
| `==`, `!=`, `<`, `<=`, `>`, `>=` | 符号と絶対値による全順序比較 | なし |
| `Display` / `Parse` | 10 進文字列との相互変換（`Parse` は `of_string` と同仕様） | `Parse` 失敗時は `None` |
| `Hash` / `Default` | `HashMap` 等のキー利用に対応、`Default.default` は `0I` | なし |

`BigInt` にはビット論理演算子や `as i64` キャストはありません。固定幅整数への変換には範囲検査を行う `BigInt.to_i64` を使用します。

## 公開関数一覧（全 4 関数）

| 関数 | シグネチャ | 失敗 | 説明 |
| --- | --- | --- | --- |
| `BigInt.of_i64` | `i64 -> BigInt` | なし | 任意の `i64` 値を正確に `BigInt` へ変換 |
| `BigInt.to_i64` | `ref BigInt -> Maybe<i64>` | `i64` 範囲外で `None` | 値を消費せず `i64` への縮小変換を試みる |
| `BigInt.of_string` | `ref string -> Maybe<BigInt>` | 不正形式で `None` | 省略可能な先頭 `-` と ASCII 10 進数字列を解析 |
| `BigInt.compare` | `ref BigInt -> ref BigInt -> i64` | なし | `left < right` なら `-1`、等しければ `0`、`left > right` なら `1` |

`BigInt.of_string`（および `Parse.parse`）が受理するのは先頭の `-`（任意）と連続する ASCII 数字 `'0'`〜`'9'` のみです。先頭の `+`、`0x` / `0b` プレフィックス、アンダースコア `_`、前後の空白文字を含む入力はいずれもトラップせず `None` を返します。

```tsuzuri run=sum%3D9223372036854775808%20parsed%3D-1200%20plus%3Dnone%20cmp%3D1
def step_up :: BigInt -> BigInt
fn step_up x = x + 1I

let sum = step_up (BigInt.of_i64 9223372036854775807i64)
let parsed = BigInt.of_string "-1200" |> Maybe.default_value 0I
let plus = match BigInt.of_string "+12" with
    | Some _ -> "some"
    | None -> "none"
let cmp = BigInt.compare (ref sum) 0I
$"sum={sum} parsed={parsed} plus={plus} cmp={cmp}"
```

## 所有権・内部表現・計算量上の注意

- **不透明フィールドと `Copy` のコスト**: `BigInt` の内部フィールド（`negative`, `limbs`）はモジュール外に対して非公開であり、直接アクセスやレコード分解は `E1022` となります。`Copy` 型であるため関数へ値渡ししても元の変数を引き続き参照できますが、値渡しでの演算では内部の桁配列が複製され得ます。
- **アルゴリズム特性**: 内部は $10^9$ 進のリム配列であり、加減算はリム数に対して $O(n)$、乗算と長除算は筆算ベースの $O(n \cdot m)$ です（Karatsuba 法や FFT 乗算は用いません）。`i64` や `i128` に収まる計算では固定幅整数型の方が大幅に高速です。

## 関連項目

- [Int](int.md)
- [リテラル](../../syntax/literals.md)
- [プリミティブ型](../../types/primitive-types.md)
- [Maybe](../core/maybe.md)
- [標準ライブラリの設計規約](../conventions.md)
