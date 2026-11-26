# Simd

`Simd` は、レーン型とレーン数を型名に明示した 128 ビットおよび 256 ビットの固定幅 SIMD ベクトル値型・マスク型と、それらのロード・ストア・レーン比較・選択・縮約を提供する組み込みモジュールです。オプティマイザ任せの自動ベクトル化とは独立に、データ並列のベクトル演算を言語の型と演算子で直接記述したい場面で使用します。

## 要点

- すべてのベクトル型・マスク型はヒープ確保を伴わない `Copy`・`Send`・`Sync` 値型です（サイズは 128 ビット型が 16 バイト、256 ビット型が 32 バイト、アライメント上限は 16 バイト）。
- `Simd.load` と `Simd.store` は非整列（unaligned）アクセスに対応し、全レーンがスライス境界内に収まることを事前検査します（範囲外の `store` は 1 要素も書き換えずにトラップします）。
- レーン比較（`Simd.eq`, `Simd.lt` 等）は単一の `bool` ではなく対応幅のマスク型を返し、`Simd.select` による分岐なし選択や `Simd.all` / `Simd.any` による集約と組み合わせます。
- `Simd.sum_lanes` はベクトル幅によらず必ずレーン `0` から昇順（`((v0 + v1) + v2) + ...`）に加算するため、浮動小数点でも丸め順序が変化しません。
- 関数属性 `@cpu ["avx2"]` 等と併用することで、単一バイナリ内で実行時の CPU 機能に応じた命令セット多版化（multiversioning）を行えます。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)において、`Simd` はハードウェア数値プリミティブの免除カテゴリに属し、LLVM の組込ベクトル操作と対応する順序（`Simd.load array offset`、`Simd.store mut_slice offset vec`、`Simd.extract vec index`、`Simd.replace vec index scalar`、`Simd.select mask on_true on_false`）を取ります。

## ベクトル型とマスク型一覧

512 ビット型、gather / scatter、整数ベクトルの除算・剰余、および公開 C ABI（`extern` / `export`）での直接受け渡しはサポートしていません。

| レーン幅 | 128 ビット数値ベクトル（16 B） | 256 ビット数値ベクトル（32 B） | 対応するマスク型 |
| --- | --- | --- | --- |
| 8 ビット | `i8x16`, `i8ux16` | `i8x32`, `i8ux32` | `mask8x16` / `mask8x32` |
| 16 ビット | `i16x8`, `i16ux8` | `i16x16`, `i16ux16` | `mask16x8` / `mask16x16` |
| 32 ビット | `i32x4`, `i32ux4`, `f32x4` | `i32x8`, `i32ux8`, `f32x8` | `mask32x4` / `mask32x8` |
| 64 ビット | `i64x2`, `i64ux2`, `f64x2` | `i64x4`, `i64ux4`, `f64x4` | `mask64x2` / `mask64x4` |

## サポートされる演算子

スカラーとベクトルの暗黙混在演算は行われないため、スカラー定数を足し引き・乗算する際は `Simd.splat` で明示的にブロードキャストします。

| 演算子 | 対象ベクトル型 | 意味・境界仕様 |
| --- | --- | --- |
| `+`, `-`, `*` | 全数値ベクトル型 | レーンごとの加減乗算（整数は 2 の補数折り返し、浮動小数点は暗黙 FMA なし） |
| `/` | 浮動小数点ベクトル（`f32x4` 等） | レーンごとの IEEE 754 除算（整数ベクトルの `/`・`%` は不可） |
| 単項 `-` | 符号付き整数・浮動小数点ベクトル | レーンごとの符号反転 |
| `&&&`, `\|\|\|`, `^^^`, `~~~` | 整数ベクトルおよび全マスク型 | レーン・マスクビットごとのビット論理演算 |
| `<<<`, `>>>` | 整数ベクトル | レーンごとのシフト（シフト量は `レーンビット幅 - 1` でマスク） |

ベクトル型には `Eq` / `Ord` インスタンスは定義されません（`v1 == v2` はコンパイルエラー）。レーン比較には `Simd.eq` 等を使用します。

## 組み込み関数一覧（全 20 関数）

`Simd.splat` や `Simd.load` のように入力引数だけでは 128 ビット版か 256 ビット版かが定まらない関数は、`let v: i32x4 = Simd.load (ref xs) 0` のように呼び出し側で具体型を確定させます。

### 構築・レーン操作・メモリアクセス（10 関数）

| 関数 | シグネチャ（概念型） | 失敗・トラップ条件 | 説明 |
| --- | --- | --- | --- |
| `Simd.splat` | `SimdVector<'v, 'lane> => 'lane -> 'v` | 型未確定でコンパイルエラー | 全レーンを同一スカラー値で埋めたベクトルを生成 |
| `Simd.of_lanes2` | `'lane -> 'lane -> 'v2` | なし | 2 レーンベクトル（`i64x2`, `f64x2`, `mask64x2` 等）を構築 |
| `Simd.of_lanes4` | `'lane × 4 -> 'v4` | なし | 4 レーンベクトル（`i32x4`, `f32x4`, `f64x4` 等）を構築 |
| `Simd.of_lanes8` | `'lane × 8 -> 'v8` | なし | 8 レーンベクトル（`i16x8`, `i32x8`, `f32x8` 等）を構築 |
| `Simd.of_lanes16` | `'lane × 16 -> 'v16` | なし | 16 レーンベクトル（`i8x16`, `i16x16` 等）を構築 |
| `Simd.of_lanes32` | `'lane × 32 -> 'v32` | なし | 32 レーンベクトル（`i8x32`, `i8ux32`, `mask8x32`）を構築 |
| `Simd.extract` | `'v -> i64 -> 'lane` | レーン番号の範囲外でトラップ | 指定位置のレーン値をスカラーとして取り出す |
| `Simd.replace` | `'v -> i64 -> 'lane -> 'v` | レーン番号の範囲外でトラップ | 指定位置のレーンを差し替えた新しいベクトルを返す |
| `Simd.load` | `ref ['lane] -> i64 -> 'v` | `offset ..< offset + lanes` が範囲外でトラップ | 配列の指定オフセットから連続レーンを読み込む |
| `Simd.store` | `ref mut ['lane..] -> i64 -> 'v -> unit` | 範囲外なら何も書かずにトラップ | 排他スライス（`ref mut xs[..]` 等）へ連続レーンを書き戻す |

### レーン比較・マスク選択・集約（10 関数）

| 関数 | シグネチャ（概念型） | 説明 |
| --- | --- | --- |
| `Simd.eq` / `Simd.ne` | `'v -> 'v -> 'mask` | レーンごとの等値・非等値マスク（NaN は `eq` が偽、`ne` が真） |
| `Simd.lt` / `Simd.le` / `Simd.gt` / `Simd.ge` | `'v -> 'v -> 'mask` | レーンごとの大小比較マスク（NaN が絡む比較は偽） |
| `Simd.select` | `'mask -> 'v -> 'v -> 'v` | マスクが真のレーンは第 2 引数、偽のレーンは第 3 引数を選択（両引数とも正格評価） |
| `Simd.all` | `'mask -> bool` | 全レーンが真のとき `true` |
| `Simd.any` | `'mask -> bool` | 少なくとも 1 レーンが真のとき `true` |
| `Simd.sum_lanes` | `'v -> 'lane` | レーン `0` から末尾レーンまで左結合で順に加算したスカラー値 |

```tsuzuri run=sum4%3D14%20picked%3D%5B10%2C%202%2C%2030%2C%204%5D%20stored%3D111
let src = [1i32, 2i32, 3i32, 4i32]
let v: i32x4 = Simd.load (ref src) 0
let shifted = v + Simd.splat 1i32
assert (Simd.all (Simd.gt shifted v))
let sum4 = Simd.sum_lanes shifted

let hi: i32x4 = Simd.of_lanes4 10i32 20i32 30i32 40i32
let mask = Simd.eq (v &&& Simd.splat 1i32) (Simd.splat 1i32)
let blended = Simd.select mask hi v
let mut out4 = [0i32, 0i32, 0i32, 0i32]
Simd.store (ref mut out4[0 ..< 4]) 0 blended

let mut buf = [1i32, 2i32, 3i32, 4i32, 5i32, 6i32, 7i32, 8i32, 9i32]
let v8: i32x8 = Simd.load (ref buf) 1
Simd.store (ref mut buf[1..]) 0 (v8 * Simd.splat 10i32)
let stored = buf[0] + buf[1] + buf[8]
$"sum4={sum4} picked={out4} stored={stored}"
```

## ターゲットコード生成と `@cpu` 多版化

- **ネイティブターゲット**: 算術・比較・選択は LLVM のベクトル型・ベクトル命令へ直接展開されます。256 ビット命令を持たないターゲット（AArch64 NEON や SSE4.2 世代の x86-64）では、LLVM バックエンドが自動的に 2 本の 128 ビット演算へ分割して同一の意味論を維持します。
- **`@cpu` による実行時ディスパッチ**: 関数宣言に `@cpu ["avx2"]` などの属性を付与すると、移植可能なベースライン版に加えて指定命令セット向けの特殊化コードが同一バイナリ内に生成され、実行時の CPU 機能検出によって自動選択されます（受理される機能名は x86-64 Linux/macOS の `"sse4.2"`, `"avx2"`, `"avx512"` および AArch64 Linux の `"sve"`, `"sve2"`。なお、引数または戻り値のシグネチャ自体に 256 ビットベクトル型が現れる関数には `@cpu` を付与できず `E1005` となるため、配列スライスを引数に取るカーネル関数へ `@cpu` を付与します）。詳細は[契約と属性](../../expressions/contracts-and-attributes.md)を参照してください。
- **WebAssembly**: 既定の `wasm32` 出力ではスカラー命令列へ展開され、`--wasm-feature simd128` を明示したビルドでのみ WebAssembly `v128` 命令が出力されます（`relaxed-simd` は使用しません）。

## 関連項目

- [契約と属性](../../expressions/contracts-and-attributes.md)
- [コンパイラオプション](../../compiler/options.md)
- [WebAssembly](../../compiler/webassembly.md)
- [Math](math.md)
- [Matrix](matrix.md)
- [Parallel](../sync/parallel.md)
- [標準ライブラリの設計規約](../conventions.md)
