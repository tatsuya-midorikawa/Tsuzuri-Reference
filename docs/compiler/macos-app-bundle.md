# macOS のアプリケーションバンドル（`--emit app`）

macOS（Apple Silicon）では、`tsuzuri build --emit app` が、Finder・Dock・LaunchServices が扱うアプリケーションバンドル `Name.app` を直接出力します。実行ファイル・`Info.plist`・`PkgInfo`・資源・埋め込みライブラリを組み立て、内側から ad-hoc で署名し、`-g` ではデバッガーが自動で読む `Name.app.dSYM` を横に作ります。シェルで手組みするときに必ず当たる罠（署名のやり直し、bundle の中の `.dwarf`、資源の拡張属性）を、コンパイラが 1 つの出力の種類として引き受けます。

## 要点

- `tsuzuri build <入力> --emit app -o Name.app` と書きます。`Name` が実行ファイルの名前（`Contents/MacOS/Name`）になります。
- ルートパッケージの `Tsuzuri.toml` の `[macos]` に `bundle_id` が必要です。`name`・`version`・`build`・`icon`・`resources`・`embed`・`info_plist`・`category`・`ui_element` は任意で、省略したキーは `Info.plist` に書きません。
- 中の実行ファイルは、同じオプションの `--emit exe` と同じものです。リンク行もビルドキャッシュの鍵も変わりません。
- 署名は ad-hoc です。`codesign --verify --deep --strict` を通り、署名の Identifier は `bundle_id` になります。Developer ID の署名・hardened runtime・公証には、まだ対応していません。
- 既存の `Name.app` は、前回の同じアプリ（`bundle_id` と実行ファイルの名前が一致するもの）のときだけ置き換えます。失敗したビルドは、前のバンドルをそのまま残します。
- macOS のホストと Apple のターゲットでだけ使えます。

## 使い方

```text
Probe/
  Tsuzuri.toml
  Main.tz
  assets/Probe.icns
```

```toml
[package]
name = "probe"
version = "0.1.0"

[macos]
bundle_id = "dev.example.probe"
name = "Probe"
version = "0.1.0"
build = "1"
icon = "assets/Probe.icns"
ui_element = true
```

```tsuzuri
def main :: unit -> i32 = \() ->
    let! directory = Env.current_dir ()
    let! executable = Env.executable_path ()
    do! IO.writeln (match directory with
        | Result.Ok text -> "cwd=" + text
        | Result.Error error -> Os.message error)
    do! IO.writeln (match executable with
        | Result.Ok text -> "exe=" + text
        | Result.Error error -> Os.message error)
    0
```

```sh
tsuzuri build Probe --emit app -o out/Probe.app
codesign --verify --deep --strict out/Probe.app        # 署名の検証
open --stdout out.txt out/Probe.app                    # LaunchServices から起動
```

`open` や Finder から起動したアプリケーションの作業ディレクトリは `/` です。上の例の `out.txt` は `cwd=/` と `exe=<絶対パス>/out/Probe.app/Contents/MacOS/Probe` の 2 行になります。バンドルの中の資源は、[`Env.executable_path`](../stdlib/sys/env.md) が返すパスから `../Resources/…` をたどって探します。

`-o` を省略すると、入力の拡張子を `app` に替えた名前（`Main.tz` は `Main.app`）になります。出力が `.app` で終わらない、または拡張子を除いた名前が空の場合は `E2000`（`output_extension_invalid`）です。

## `[macos]` のバンドルのキー

| キー | 値 | `Info.plist`・バンドルでの扱い |
| --- | --- | --- |
| `bundle_id` | 英数字・`-`・`.` だけの逆 DNS 名（例: `"dev.example.app"`。空の成分は不可） | `CFBundleIdentifier`。`--emit app` では必須 |
| `name` | 空でなく、`/` と制御文字を含まない文字列 | `CFBundleName` |
| `version` | `.` で区切った 1〜3 個の整数（各 0〜2147483647） | `CFBundleShortVersionString` |
| `build` | `version` と同じ形 | `CFBundleVersion` |
| `icon` | `.icns` ファイルへの相対パス | `Contents/Resources/<ファイル名>` へ写し、`CFBundleIconFile` に書く |
| `resources` | ファイルかディレクトリへの相対パスの 1 行の配列 | `Contents/Resources/<最後の成分>` へ写す（ディレクトリは中身ごと） |
| `embed` | Mach-O のファイルか `.framework` ディレクトリへの相対パスの 1 行の配列 | `Contents/Frameworks/<最後の成分>` へ写し、先に署名する |
| `info_plist` | XML の property list への相対パス | 最上位の辞書のキーを `Info.plist` に足す |
| `category` | `public.app-category.` に英小文字と `-` が続く文字列 | `LSApplicationCategoryType` |
| `ui_element` | `true` か `false` | `LSUIElement`（Dock に出ないアプリ） |

- 読むのはルートパッケージの `[macos]` だけです。依存パッケージの `[macos]` は使いません。
- 値の形はマニフェストを読むたびに検査します。誤りは出力の種類によらず `E0002`（`invalid_macos_setting`）、知らないキーは `E0002`（`unknown_manifest_key`）、同じキーの重複は `E0002`（`duplicate_manifest_key`）です。
- 値を使うのは `--emit app` だけです。`--emit exe`・`run`・`test`・`bench` と Apple 以外のターゲットのビルドは、これらのキーがあっても何も変わりません。
- 省略したキーを `[package]` の `name`・`version` から補うことはありません。識別子は署名・通知・設定の鍵になるので、暗黙の値にしません。
- パスはルートパッケージのディレクトリからの相対パスです。`icon` と `resources` の写し先の名前どうし、`embed` の写し先の名前どうしが（ASCII の大文字小文字を無視して）重なると `E0002` です。
- アイコンは `.icns` だけを受け付けます。`.png` からは `iconutil -c icns <名前>.iconset` で作れます。

## バンドルの形と `Info.plist`

```text
Name.app/
  Contents/
    Info.plist
    PkgInfo                       "APPL????"（8 バイト）
    MacOS/Name                    実行ファイル
    Resources/…                   icon と resources があるとき
    Frameworks/…                  embed があるとき
    _CodeSignature/CodeResources  codesign が作る
Name.app.dSYM/                    -g のとき
Name.app.trap.json                --trap-info のとき
```

コンパイラが `Info.plist` に書くキーは次のとおりです。

| キー | 値 | いつ |
| --- | --- | --- |
| `CFBundleExecutable` | 実行ファイルの名前 | 常に |
| `CFBundleIdentifier` | `bundle_id` | 常に |
| `CFBundleInfoDictionaryVersion` | `6.0` | 常に |
| `CFBundlePackageType` | `APPL` | 常に |
| `LSMinimumSystemVersion` | 実行ファイルに記録された最低 OS 版（既定は `12.0`） | 常に |
| `NSHighResolutionCapable` | `true` | 常に |
| `CFBundleName`・`CFBundleShortVersionString`・`CFBundleVersion`・`CFBundleIconFile`・`LSApplicationCategoryType`・`LSUIElement` | `name`・`version`・`build`・`icon`・`category`・`ui_element` | キーを書いたとき |

- `LSMinimumSystemVersion` は、リンクした実行ファイルの `LC_BUILD_VERSION` から読みます。`[macos] min_version` や `MACOSX_DEPLOYMENT_TARGET` を指定すると、実行ファイルを通ってここに届くので、実行ファイルと食い違いません。
- 出力は XML で、`plutil -convert xml1` と同じバイト列です（キーは UTF-16 の符号単位の順、字下げはタブ）。同じ入力からは、どの機械でも同じ `Info.plist` ができます。
- `info_plist` のファイルに書いたキー（`NSHumanReadableCopyright`・`NSAppTransportSecurity`・`NSPrincipalClass` など）は、値を変えずに足します。上の表の 12 個のキーと重なると、`[macos]` で設定していなくても `E2000`（`macos_bundle_conflict`）です。値を決める場所を 1 つにするためです。
- `info_plist` は XML の property list の部分集合として読みます。使える要素は `dict`・`array`・`string`・`integer`・`real`・`true`・`false`・`date`・`data` で、コメント・XML 宣言・Apple の DOCTYPE は読み飛ばします。バイナリ形式、CDATA、ほかの DOCTYPE や処理命令、重複したキー、128 段を超える入れ子、1 MiB を超えるファイル、最上位が辞書でないものは `E2001`（`macos_bundle_input_invalid`）です。バイナリ形式は `plutil -convert xml1 <ファイル>` で変換できます。
- `integer`・`real`・`date` は形を検査して、書かれた文字列のまま写します。`plutil` は `<real>2.0</real>` を `2` に直しますが、コンパイラは直しません。

## 資源と埋め込みライブラリ

- 写すのは、中身のバイトと実行権限の有無（`0o755` か `0o644`）だけです。拡張属性（`com.apple.FinderInfo`・`com.apple.quarantine` など）・ACL・時刻は写しません。Finder の拡張属性が付いた資源は `codesign` が拒むためです。
- ディレクトリの中のシンボリックリンクは、相対で、写すディレクトリの外へ出ないものだけを同じリンクとして写します。それ以外は `E2001`（`macos_bundle_input_invalid`）です。マニフェストに書いたパスそのものがリンクのときは、リンク先を写します。
- `embed` に置けるのは Mach-O のファイル（dylib など）と `.framework` のディレクトリだけです。`Contents/Frameworks` にコードでないファイルがあると署名が壊れるので、それ以外は `E2001` で拒み、`resources` に置くよう案内します。
- `--emit app` はリンク行を変えません。`embed` した `@rpath/libfoo.dylib` を実行時に読ませるには、リンクのときに rpath を足します。

  ```sh
  tsuzuri build App --emit app --link vendor/libfoo.dylib --rpath @executable_path/../Frameworks -o out/App.app
  ```

- 入力の誤り（読めないファイルは `E2001` `io_failure`、`icns` でないアイコンや上の規則に合わない入力は `E2001` `macos_bundle_input_invalid`）は、実行ファイルをビルドする前に報告します。

## 署名と `.dSYM`

- 署名は `codesign --force --sign -`（ad-hoc）です。`embed` の各要素、最後にバンドルの順に内側から署名し、`--deep` と hardened runtime は使いません。`codesign` は `PATH` から探します（`/usr/bin/codesign`。Xcode Command Line Tools に含まれます）。起動できなければ `E2002`（`external_tool_not_runnable`）、失敗すれば `E2002`（`external_tool_failed`）です。
- `-g` を付けると、`Name.app.dSYM/Contents/Resources/DWARF/Name` と、その `Info.plist`（識別子は `com.apple.xcode.dsym.<bundle_id>`）を作ります。UUID が実行ファイルと一致するので、lldb は `target symbols add` なしでソースの行を出します。`--emit exe` の平らな `.dwarf` は作りません。

  ```sh
  tsuzuri build Probe --emit app -g -o out/Probe.app
  lldb out/Probe.app
  ```

- `-g` のないビルドは `Name.app.dSYM` を作らず、既存のものにも触れません（UUID が合わないので、古い dSYM をデバッガーは読みません）。

## 置き換えとキャッシュ

- バンドルは出力先の横の一時ディレクトリで組み立てて署名し、最後に入れ替えます。入力の誤り・リンクの失敗・署名の失敗のどこで止まっても、前のバンドルはそのまま残り、中途半端なバンドルは残りません。
- 既存の `Name.app` を置き換えるのは、それがシンボリックリンクでないディレクトリで、`Contents/Info.plist` の `CFBundleIdentifier` と `CFBundleExecutable` が今回の `bundle_id` と実行ファイルの名前に一致するときだけです。`Name.app.dSYM` は、`CFBundlePackageType` が `dSYM` で識別子が一致するときだけです。違えば `E2003`（`app_output_not_owned`）で、`-o` の書き間違いで別のアプリを消すことはありません。
- 出力のバンドルがプロジェクトのソース・マニフェスト・`[macos]` の入力を含む場合は `E2003`（`output_overwrites_input`）、リンク入力を含む場合は `E2003`（`output_overwrites_link_input`）です。
- ビルドキャッシュに入るのは中の実行ファイルだけです。同じソースとオプションの `--emit exe` と同じ項目を使います。資源・`Info.plist`・署名は鍵に入らず、バンドルの組み立てと署名は、キャッシュに当たっても毎回行います。

## 診断

| 条件 | コード | `kind` |
| --- | --- | --- |
| `[macos]` の値の形、写し先の名前の重なり | `E0002` | `invalid_macos_setting` |
| macOS でないホスト、Apple でないターゲット | `E2000` | `option_unsupported_platform` |
| 出力が `.app` で終わらない | `E2000` | `output_extension_invalid` |
| `[macos] bundle_id` がない | `E2000` | `macos_bundle_id_missing` |
| `info_plist` のキーが生成するキーと重なる | `E2000` | `macos_bundle_conflict` |
| 入力を読めない | `E2001` | `io_failure` |
| 入力の中身が規則に合わない | `E2001` | `macos_bundle_input_invalid` |
| `codesign` を起動できない・失敗した | `E2002` | `external_tool_not_runnable`・`external_tool_failed` |
| 既存の出力が今回のアプリのものでない | `E2003` | `app_output_not_owned` |
| 出力がソース・入力・リンク入力を含む | `E2003` | `output_overwrites_input`・`output_overwrites_link_input` |

中の実行ファイルに関するオプションの組み合わせ（`--strip`・`--trap-mode`・`--subsystem` など）は、`--emit exe` と同じ規則で検査し、同じ診断を出します。

## 注意と制限

- **署名の範囲**: ad-hoc の署名は、ビルドした Mac での実行と開発中の配布に使えます。ほかの利用者へ配るための Developer ID の署名・hardened runtime・entitlements・公証は、まだコンパイラにありません。
- **プロジェクトの中の `.framework`**: モジュール探索はプロジェクトのディレクトリをすべてたどり、ディレクトリへのシンボリックリンクを `E1011` で拒みます。`Versions/Current` のようなリンクを持つ `.framework` は、プロジェクトのディレクトリの外に置いて `embed = ["../vendor/Foo.framework"]` のように指定し、それを埋め込んだバンドルの出力先（`-o`）もプロジェクトのディレクトリの外にしてください。
- **標準出力と報告**: Finder・Dock・`open` から起動したアプリの標準出力と標準エラーは `/dev/null` です。`IO.writeln` の出力は見えませんが、トラップの位置の行（`--trap-info`）と tzroutine ランタイムの報告・スタックのあふれは unified logging（subsystem `dev.tsuzuri.runtime`）に残り、Console.app と `log show` で読めます（[Finder から起動したアプリの報告](./debugging.md#finder-から起動したアプリの報告)）。
- **メインスレッド**: AppKit の呼び出しはメインスレッドで行います。tzroutine やコールバックからメインスレッドへ処理を戻すには [MainThread](../stdlib/sync/mainthread.md) を使います。
- **App Translocation**: 隔離属性（quarantine）の付いたバンドルを Finder から開くと、OS が読み取り専用の別の場所へ移して起動します。`Env.executable_path` はその場所を返します。資源は実行ファイルからの相対で探し、バンドルの外のファイルを当てにしないでください。
- **対応しない形**: Universal 2（Intel Mac）、App Sandbox と Mac App Store の提出、`.png` からのアイコンの変換、NIB・storyboard・asset catalog のコンパイル、`--emit shared` の dylib を `.framework` にすることには対応していません。
- `run`・`test`・`bench` は `--emit` を受け付けません。バンドルの中の実行ファイルを端末から直接起動して確かめることはできます（`out/Probe.app/Contents/MacOS/Probe`）。

## 関連項目

- [パッケージ管理](../modules/packages.md)
- [コンパイラオプションと環境変数](./options.md)
- [対応プラットフォームとクロスコンパイル](./platforms.md)
- [デバッグ](./debugging.md)
- [MainThread](../stdlib/sync/mainthread.md)
- [Objective-C 連携（`extern class` と `ObjC`）](./objective-c.md)
- [Env](../stdlib/sys/env.md)
- [診断メッセージとエラーコード](./diagnostics.md)
