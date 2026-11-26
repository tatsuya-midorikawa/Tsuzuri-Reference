# Int

`Int` は、`i8` から `i128` までの符号付き・符号なし固定幅整数型に対して、検査付き算術・飽和算術・明示的折り返し算術・ビット計測と操作・最大公約数・床除算・拡大乗算を提供する組み込みモジュールです。暗黙のビット幅拡張は一切行わず、入力と同じ整数幅・符号を厳格に保ちます。

任意精度整数が必要な場合は[`BigInt`](bigint.md)、整数型の種類やリテラル接尾辞については[プリミティブ型](../../types/primitive-types.md)および[リテラル](../../syntax/literals.md)を参照してください。

## 要点

- 対象となる型クラス制約は `Integer<'a>`（8 / 16 / 32 / 64 / 128 ビットの符号付き・符号なし全 10 型）、`SignedInteger<'a>`（符号付き 5 型）、`UnsignedInteger<'a>`（符号なし 5 型）です。
- オーバーフロー時の契約を目的に応じて **通常の演算子 / `Int.wrapping_*`**（2 の補数折り返し）、**`Int.checked_*`**（`Maybe.None` 返却）、**`Int.saturating_*`**（最小値・最大値への飽和）、**`@checked` 式**（`OverflowException` 送出）の 4 通りから明示的に選択できます。
- 固定幅整数はすべて `Copy` 値型であり、ヒープ確保を伴わず LLVM の対応命令・組込関数（intrinsic）へ直接展開されます。
- ビット計測結果、循環シフト量、および `wrapping_pow` / `checked_pow` の指数は被演算子の幅によらず `i64` 型で統一されています。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)において、`Int` モジュールは数式・数値演算の免除カテゴリに属し、被演算子は数式どおり左から右の順序（`Int.checked_sub left right`、`Int.clamp value low high`、`Int.rotate_left value amount`、`Int.checked_pow base exp`）で受け取ります。

## オーバーフロー処理モデルの選択

```tsuzuri run=clamp%3D10%20sat%3D300%20wrap%3D-128%20chk%3Dnone
let clamped = Int.clamp 12 0 10
let sat = Int.saturating_add 200i16 100i16
let wrap = Int.wrapping_add 127i8 1i8
let chk = match Int.checked_add 2147483647 1 with
    | Some _ -> "some"
    | None -> "none"
$"clamp={clamped} sat={sat} wrap={wrap as i64} chk={chk}"
```

通常の二項演算子 `+`・`-`・`*` は折り返し動作ですが、`tsuzuri test` や `--overflow-report` 有効時には意図せぬ折り返しとして検出・報告されます。ハッシュ計算や乱数生成のように折り返し自体が仕様である箇所には `Int.wrapping_*` を用いることで、意図を明示しつつ `--overflow-report` の警告対象から除外できます。一方、スコープ内で例外として捕捉したい場合は `@checked (x + y)` を使用します（[エラー処理と例外](../../expressions/error-handling.md)参照）。

## 組み込み関数一覧（全 36 関数）

### 選択・絶対値・数論・床除算（12 関数）

| 関数 | シグネチャ | 失敗・境界動作 | 説明 |
| --- | --- | --- | --- |
| `Int.min` | `Integer<'a> => 'a -> 'a -> 'a` | なし | 小さい方の値を返す |
| `Int.max` | `Integer<'a> => 'a -> 'a -> 'a` | なし | 大きい方の値を返す |
| `Int.clamp` | `Integer<'a> => 'a -> 'a -> 'a -> 'a` | `low > high` でトラップ | `value` を閉区間 `[low, high]` に収める |
| `Int.abs` | `SignedInteger<'a> => 'a -> 'a` | 最小値は最小値のまま折り返す | 符号付き整数の絶対値 |
| `Int.unsigned_abs` | `SignedInteger<'a> => 'a -> 'u` | なし（最小値も正確に表現） | 同幅の符号なし整数型 `'u` で絶対値を返す |
| `Int.abs_diff` | `Integer<'a> => 'a -> 'a -> 'u` | なし | 2 値の差の絶対値を同幅の符号なし整数型 `'u` で返す |
| `Int.gcd` | `Integer<'a> => 'a -> 'a -> 'a` | 符号付き最小値同士は折り返す | 最大公約数（`gcd 0 0` は `0`） |
| `Int.lcm` | `Integer<'a> => 'a -> 'a -> 'a` | 溢れ時は同幅で折り返す | 最小公倍数（いずれかが `0` なら `0`） |
| `Int.checked_gcd` | `Integer<'a> => 'a -> 'a -> Maybe<'a>` | 表現不能時に `None` | オーバーフロー検査付きの最大公約数 |
| `Int.checked_lcm` | `Integer<'a> => 'a -> 'a -> Maybe<'a>` | 溢れ時に `None` | オーバーフロー検査付きの最小公倍数 |
| `Int.div_floor` | `Integer<'a> => 'a -> 'a -> 'a` | `0` 除算および `MIN / -1` でトラップ | 負の無限大方向へ丸める床除算（通常の `/` はゼロ方向切り捨て） |
| `Int.rem_floor` | `Integer<'a> => 'a -> 'a -> 'a` | `0` 除算および `MIN % -1` でトラップ | 床除算に対応する剰余（除数と同じ符号または `0`） |

`unsigned_abs`・`abs_diff`・`widening_mul` は入力型から一意に対応する出力型を決定するため、呼び出し箇所で具体的な整数幅が確定している必要があります（未確定の型変数のままでは `E1015`）。

```tsuzuri run=abs_min%3D128%20diff%3D255%20gcd%3D6%20fdiv%3D-4%20frem%3D1
let abs_min = Int.unsigned_abs (-128i8)
let diff = Int.abs_diff (-128i8) 127i8
let g = Int.gcd (-18) 24
let fd = Int.div_floor (-7) 2
let fr = Int.rem_floor (-7) 2
$"abs_min={abs_min} diff={diff} gcd={g} fdiv={fd} frem={fr}"
```

### ビット計測・ビット操作（8 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Int.count_ones` | `Integer<'a> => 'a -> i64` | 値が `1` であるビットの個数（popcount） |
| `Int.leading_zeros` | `Integer<'a> => 'a -> i64` | 最上位ビットから連続する `0` の個数（入力 `0` では型のビット幅） |
| `Int.trailing_zeros` | `Integer<'a> => 'a -> i64` | 最下位ビットから連続する `0` の個数（入力 `0` では型のビット幅） |
| `Int.rotate_left` | `Integer<'a> => 'a -> i64 -> 'a` | 左循環シフト（回転量は `amount &&& (幅 - 1)` でマスク） |
| `Int.rotate_right` | `Integer<'a> => 'a -> i64 -> 'a` | 右循環シフト（負の回転量もビット幅マスクで安全に処理） |
| `Int.swap_bytes` | `Integer<'a> => 'a -> 'a` | エンディアン変換（バイト順の反転。8 ビット型では恒等変換） |
| `Int.reverse_bits` | `Integer<'a> => 'a -> 'a` | ビット順の完全反転 |
| `Int.is_power_of_two` | `UnsignedInteger<'a> => 'a -> bool` | 符号なし整数が 2 の冪（`1`, `2`, `4`, ...）であれば `true`（`0` は `false`） |

通常のビット論理演算子（`&&&`, `|||`, `^^^`, `~~~`）およびシフト演算子（`<<<`, `>>>`、論理右シフト `Bits.ushr`）については[演算子](../../expressions/operators.md)を参照してください。

```tsuzuri run=ones%3D3%20lz%3D28%20rot%3D1%20swap%3D65280%20pow2%3Dtrue
let ones = Int.count_ones 0b1101i32
let lz = Int.leading_zeros 8i32
let rot = Int.rotate_left 0b10000000i8u 1
let swap = Int.swap_bytes 0x00FFi16u
let pow2 = Int.is_power_of_two 16i32u
$"ones={ones} lz={lz} rot={rot as i64} swap={swap} pow2={pow2}"
```

### 検査付き・飽和・折り返し算術と累乗・拡大乗算（16 関数）

| 関数 | シグネチャ | 失敗・境界動作 |
| --- | --- | --- |
| `Int.checked_add` | `Integer<'a> => 'a -> 'a -> Maybe<'a>` | オーバーフロー時に `None` |
| `Int.checked_sub` | `Integer<'a> => 'a -> 'a -> Maybe<'a>` | オーバーフロー時に `None` |
| `Int.checked_mul` | `Integer<'a> => 'a -> 'a -> Maybe<'a>` | オーバーフロー時に `None` |
| `Int.checked_div` | `Integer<'a> => 'a -> 'a -> Maybe<'a>` | `0` 除算または符号付き `MIN / -1` で `None` |
| `Int.checked_rem` | `Integer<'a> => 'a -> 'a -> Maybe<'a>` | `0` 除算または符号付き `MIN % -1` で `None` |
| `Int.checked_neg` | `SignedInteger<'a> => 'a -> Maybe<'a>` | 符号付き最小値の符号反転で `None` |
| `Int.checked_pow` | `Integer<'a> => 'a -> i64 -> Maybe<'a>` | 指数 `< 0` またはオーバーフロー時に `None`（指数 `0` は `Some 1`） |
| `Int.saturating_add` | `Integer<'a> => 'a -> 'a -> 'a` | 型の最小値または最大値で飽和 |
| `Int.saturating_sub` | `Integer<'a> => 'a -> 'a -> 'a` | 型の最小値または最大値で飽和 |
| `Int.saturating_mul` | `Integer<'a> => 'a -> 'a -> 'a` | 型の最小値または最大値で飽和 |
| `Int.wrapping_add` | `Integer<'a> => 'a -> 'a -> 'a` | 2 の補数で同幅に折り返す |
| `Int.wrapping_sub` | `Integer<'a> => 'a -> 'a -> 'a` | 2 の補数で同幅に折り返す |
| `Int.wrapping_mul` | `Integer<'a> => 'a -> 'a -> 'a` | 2 の補数で同幅に折り返す |
| `Int.wrapping_neg` | `SignedInteger<'a> => 'a -> 'a` | 2 の補数で同幅に折り返す（符号なし型の否定は `Int.wrapping_sub 0 x`） |
| `Int.wrapping_pow` | `Integer<'a> => 'a -> i64 -> 'a` | 指数 `0` は `1`、溢れは折り返し、負の指数はトラップ |
| `Int.widening_mul` | `Integer<'a> => 'a -> 'a -> 'w` | 同符号で 2 倍のビット幅 `'w`（`i8`→`i16`, ..., `i64`→`i128`）の正確な積を返す（`i128` / `i128u` は `E1005`） |

```tsuzuri run=wide%3D1000000000000%20cpow%3Dnone%20wpow%3D87
let wide = Int.widening_mul 1000000i32 1000000i32
let cpow = match Int.checked_pow 10i16 5 with
    | Some _ -> "some"
    | None -> "none"
let wpow = Int.wrapping_pow 7i8 3
$"wide={wide} cpow={cpow} wpow={wpow as i64}"
```

## 文字列との解析・変換と型キャスト

- **型間の数値変換**: 異なる幅・符号の整数型や浮動小数点型への変換には明示キャスト `x as i64` を使用します（[型キャスト](../../types/casts.md)参照）。
- **文字列化と解析**: 10 進文字列への変換には `to_string`（または補間文字列 `$"{x:x}"` による 16 進・2 進・8 進整形）、文字列からの安全な解析には `Parse.parse`（`0x`・`0b`・数字区切り `_` 対応、範囲外は `None`）を使用します（詳細は[`Format`](../text/format.md)参照）。

## 関連項目

- [プリミティブ型](../../types/primitive-types.md)
- [型キャスト](../../types/casts.md)
- [演算子](../../expressions/operators.md)
- [エラー処理と例外](../../expressions/error-handling.md)
- [BigInt](bigint.md)
- [Math](math.md)
- [Format](../text/format.md)
- [標準ライブラリの設計規約](../conventions.md)
