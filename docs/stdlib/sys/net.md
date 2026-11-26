# Net

`Net` は、TCP ストリーム・TCP リスナー・UDP ソケットによるネットワーク通信、厳密な IPv4 / IPv6 アドレス解析・整形、および名前解決を提供する opt-in 標準モジュールです。ソースコード中に `Net` 識別子が現れたときのみ読み込まれ、モジュール内の型やケースは常に `Net.Address`・`Net.Write`・`Net.TimedOut` のように修飾して参照します。

ソケット操作および名前解決（`Net.resolve`）にはパッケージ権限 `net` が必要です。純粋なアドレス解析・整形（`parse_address`・`address_text` など）やハンドルに保持されたアドレスの取得には権限は不要です。

> **TLS 非対応とセキュリティ上の注意**: 現在の標準ライブラリ `Net` は**平文の TCP / UDP のみを扱い、TLS（暗号化・サーバー証明書検証）には対応していません**（TLS は標準ライブラリではなく外部パッケージとして提供する設計方針です）。受信データおよび UDP の送信元アドレスは認証されないため、平文のソケット上で機密情報を送信しないでください。

## 要点

- ソケット入出力はすべて遅延アクション `IO<Result<'a, Os.Error>>` を返し、[`tzroutine`](../../concurrency/tzroutine.md) 内ではランタイムの netpoller により OS スレッドをブロックせず当該 tzroutine のみを待機させます（旧 `*_async` 関数群は廃止され `E1040` となります）。
- `Net.TcpStream`・`Net.TcpListener`・`Net.UdpSocket` は世代管理された不透明な `Copy` ハンドルです。自動クローズされないため、`Net.with_connection` などのスコープ関数か明示的な `close*` を使用します。
- タイムアウトは `Maybe<i64>`（`None` は無期限、`Some ms` は `1..=2_147_483_647` ミリ秒）で呼び出し全体のデッドラインを指定します。
- `read` と `recv_from` はメモリ枯渇を防ぐため必ず最大受信バイト数（上限 16 MiB）を指定します（「終端まで全量読む」関数はありません）。
- `Net.resolve` は曖昧な数値表記（`127.1`・8 進・16 進・全角数字など）を OS リゾルバへ渡さず、`parse_ip` と同一の厳密な規則で検証します。

## IP アドレスの解析と整形

`parse_address` は `"127.0.0.1:8080"` や `"[::1]:443"` のようなポート付きソケットアドレスを解析し、`parse_ip port text` はポートを含まない IP アドレス文字列とポート番号（`0..=65535`）から `Net.Address` を構築します。純粋関数のため、既定の `wasm32` を含む全ターゲットでインポートなしに動作します。

```tsuzuri run=127.0.0.1:8080%0A[2001:db8::1]:443%0A[::ffff:c000:201]:53%0Anone%0Anone%0Anone%0Atrue%2053
def show_addr :: ref string -> string
fn show_addr input =
    match Net.parse_address input with
    | Maybe.Some addr -> Net.address_text addr
    | Maybe.None -> "none"

def main :: unit -> i32 = \() ->
    do! IO.writeln (show_addr "127.0.0.1:8080")
    do! IO.writeln (show_addr "[2001:DB8:0:0:0:0:0:1]:443")
    let mapped = Maybe.get (Net.parse_ip 53 "::ffff:192.0.2.1")
    do! IO.writeln (Net.address_text mapped)
    do! IO.writeln (show_addr "127.1:80")
    do! IO.writeln (show_addr "010.0.0.1:80")
    do! IO.writeln (show_addr "[fe80::1%en0]:80")
    do! IO.writeln $"{Net.is_ipv6 mapped} {Net.port mapped}"
    0
```

- **厳密な構文規則**: `inet_aton` が許容する短縮形（`127.1`）、16 進表記（`0x7f.0.0.1`）、先頭ゼロ（`010.0.0.1`）、空白文字、および IPv6 ゾーン識別子（`%en0`）はすべて `None` として拒否します。これにより、アクセス制御リストの文字列検査と実際の接続先解釈が食い違う脆弱性を防ぎます。
- **RFC 5952 正規化出力**: `ip_text` と `address_text`（および `Display<Net.Address>`）は IPv6 アドレスを小文字 16 進・先頭ゼロ省略・最長の連続ゼログループ `::` 圧縮で出力します。`Address` は `Copy`・`Eq`・`Hash`・`Display` を実装します。

## TCP 通信（リスナーとストリーム）

`Net.bind` で待ち受けソケット（ポート `0` を指定すると OS が空きポートを割り当て、`Net.local_addr` で確定ポートを取得可能）を作成し、`Net.connect` と `Net.accept` で双方向の `Net.TcpStream` を確立します。`with_listener`・`with_connection`・`with_accepted` を使うと、本体の成否にかかわらずスコープ脱出前に確実にハンドルが閉じられます。

```tsuzuri run=ping%20->%20pong
def decode_ascii :: own [ubyte] -> string
fn decode_ascii bytes =
    match Utf8String.from_bytes bytes with
    | Maybe.Some text -> String.from_utf8 text
    | Maybe.None -> "?"

def exchange :: own Net.TcpStream -> own Net.TcpStream -> IO<string>
fn exchange client server = IO {
    let! s1 = Net.write client (Utf8String.to_bytes u8"ping") (Maybe.Some 1000)
    let! r1 = Net.read server 16 (Maybe.Some 1000)
    let! s2 = Net.write server (Utf8String.to_bytes u8"pong") (Maybe.Some 1000)
    let! r2 = Net.read client 16 (Maybe.Some 1000)
    return match (s1, r1, s2, r2) with
        | (Result.Ok _, Result.Ok req, Result.Ok _, Result.Ok res) ->
            $"{decode_ascii req} -> {decode_ascii res}"
        | _ -> "failed"
}

def main :: unit -> i32 = \() ->
    let loopback = Maybe.get (Net.parse_ip 0 "127.0.0.1")
    let! result = Net.with_listener loopback (\listener ->
        Net.with_connection (Net.local_addr listener) (Maybe.Some 1000) (\client ->
            Net.with_accepted listener (Maybe.Some 1000) (\server -> exchange client server)))
    do! IO.writeln (match result with
        | Result.Ok (Result.Ok (Result.Ok line)) -> line
        | _ -> "failed")
    0
```

- **`Net.read stream count timeout`**: `count` は `1..=16_777_216`（16 MiB）の範囲で指定します（範囲外は `InvalidInput`）。到着済みのデータ（最大 `count` バイト）を 1 回の受信で返すため、`count` 未満のバイト数は正常な部分読み取りです。**長さ 0 の空配列 `[]` は相手側が送信を終了したこと（EOF）**を表します。
- **`Net.write stream data timeout`**: `data` の全バイトを送信し終えるか、タイムアウト・エラーが発生するまで送信を繰り返します。相手が切断済みのストケットへ書き込んでも `SIGPIPE` でプロセスが異常終了することはなく、`ConnectionReset` 相当の `Error` が返ります。
- **`Net.shutdown stream how`**: ソケットを閉じずに片方向または双方向（`Net.Read`・`Net.Write`・`Net.Both`）の通信を終了します。`Net.Write` は相手へ FIN（ストリーム終端）を通知しつつ受信を継続するときに使います。
- **バインド設定**: `Net.bind` は POSIX で `SO_REUSEADDR`、Windows でポート乗っ取りを防ぐ `SO_EXCLUSIVEADDRUSE` を設定し、IPv6 では `IPV6_V6ONLY` を有効化します。`"0.0.0.0"` や `"::"` は外部ネットワーク全体へ公開されるため、ローカル用途には `"127.0.0.1"` または `"::1"` を使用してください。

## UDP 通信

`Net.bind_udp`（または自動クローズ付きの `Net.with_udp`）で `Net.UdpSocket` を作成し、`send_to` と `recv_from` でデータグラムを送受信します。

```tsuzuri run=hello%20true
def main :: unit -> i32 = \() ->
    let loopback = Maybe.get (Net.parse_ip 0 "127.0.0.1")
    let! outcome = Net.with_udp loopback (\receiver ->
        Net.with_udp loopback (\sender -> IO {
            let! _ = Net.send_to sender (Utf8String.to_bytes u8"hello") (Net.udp_local_addr receiver)
            let! got = Net.recv_from receiver 64 (Maybe.Some 1000)
            return match got with
                | Result.Ok (bytes, from) ->
                    let text = Result.default_value "?" (Os.decode bytes)
                    $"{text} {from == Net.udp_local_addr sender}"
                | Result.Error error -> Os.message error
        }))
    do! IO.writeln (match outcome with
        | Result.Ok (Result.Ok line) -> line
        | _ -> "failed")
    0
```

`recv_from socket count timeout`（`count` は `1..=16_777_216`）は、`count` を超えるデータグラムが到着した場合にデータを切り詰めて返さず、そのデータグラムを破棄して `InvalidInput`（`EMSGSIZE`）エラーを返します。Windows 特有の ICMP ポート到達不能による `WSAECONNRESET` もランタイム側で抑止されるため、UDP サーバーの受信ループが他クライアントの切断で中断されることはありません。

## タイムアウト・ハンドル管理・エラー分類

- **タイムアウト**: `Maybe.None` は無期限待機、`Maybe.Some ms` は `1..=2_147_483_647` ミリ秒の単調時計デッドラインです。`Some 0` や負数などを渡すとシステムコール発行前に `InvalidInput`（`code == 0`）となります。期限切れ時は `Net.error_kind` が `Net.TimedOut` となり、ソケット自体は引き続き有効に使用できます。
- **ハンドルの寿命**: ハンドルは `Drop` を実装しないため、`close` / `close_listener` / `close_udp` または `with_*` で明示的に閉じます。閉じたハンドルは無効化され、OS 側で同じファイル記述子番号が別ソケットに再利用された後でも、古いハンドルの操作は確実に `InvalidInput` となります。
- **`Net.error_kind`**: `Os.ErrorKind` に含まれないネットワーク固有の失敗原因を `Os.Error.code` から分類します。

| 事象 | `Os.Error.kind` | `Net.error_kind` |
| --- | --- | --- |
| タイムアウト期限切れ | `Other` | `Net.TimedOut` |
| 接続拒否（`ECONNREFUSED` 等） | `Other` | `Net.ConnectionRefused` |
| 接続リセット・切断・パイプ破損（`ECONNRESET`・`EPIPE` 等） | `Other` | `Net.ConnectionReset` |
| アドレス・ポート使用中（`EADDRINUSE` 等） | `AlreadyExists` | `Net.AddressInUse` |
| 利用不能なローカルアドレス（`EADDRNOTAVAIL` 等） | `InvalidInput` | `Net.AddressNotAvailable` |
| ネットワーク・ホスト到達不能 | `Other` | `Net.Unreachable` |
| 閉じたハンドル・範囲外引数・ホスト未発見 | `InvalidInput` / `NotFound` | `Net.Unclassified` |

```tsuzuri run=TimedOut%0AInvalidInput%0AInvalidInput
def show_os_kind :: own Result<'a, Os.Error> -> string
fn show_os_kind res =
    match res with
    | Result.Ok _ -> "unexpected"
    | Result.Error err ->
        match err.kind with
        | Os.InvalidInput -> "InvalidInput"
        | _ -> "other"

def main :: unit -> i32 = \() ->
    let loopback = Maybe.get (Net.parse_ip 0 "127.0.0.1")
    let! bound = Net.bind loopback
    match bound with
    | Result.Error _ -> do! IO.writeln "bind-failed"
    | Result.Ok listener ->
        let! quiet = Net.accept listener (Maybe.Some 30)
        let! _ = Net.close_listener listener
        let! closed_again = Net.close_listener listener
        let! zero_timeout = Net.accept listener (Maybe.Some 0)
        do! IO.writeln (match quiet with
            | Result.Error err -> $"{Net.error_kind err}"
            | Result.Ok _ -> "unexpected")
        do! IO.writeln (show_os_kind closed_again)
        do! IO.writeln (show_os_kind zero_timeout)
    0
```

## 名前解決（`Net.resolve`）

`Net.resolve host port` はホスト名から最大 64 件の重複なし `Net.Address` 配列を取得します。SSRF 検査バイパスを防ぐため、以下のいずれかに該当する `host` は OS リゾルバや IDNA 変換に渡さず、`Net.parse_ip port host` のみで判定します（解釈できなければ `InvalidInput`）。

- `:` または `%` を含む（IPv6 表記およびゾーン付き表記）
- 空白文字または ASCII 制御文字（`0x00`〜`0x20`、`0x7F`）を含む
- 非 ASCII バイトを含む（全角数字 `１２７．０．０．１` など。国際化ドメイン名は Punycode の `xn--...` 形式で渡す必要があります）
- 末尾ラベル（末尾の単一 `.` を除く）が数字のみ、または `0x` / `0X` で始まる（`127.1`、`0x7f000001`、`010.0.0.1` など）

空文字列・NUL を含む文字列・253 バイト超のホスト名・範囲外のポート番号は `InvalidInput`、存在しないドメイン名は `NotFound` となります。

```tsuzuri run=127.0.0.1:8080%0A[::1]:80%0Ainvalid%20input%0Ainvalid%20input
def show_resolved :: own Result<[Net.Address], Os.Error> -> string
fn show_resolved res =
    match res with
    | Result.Ok addrs -> Net.address_text addrs[0]
    | Result.Error err -> Os.message err

def main :: unit -> i32 = \() ->
    let! v4 = Net.resolve "127.0.0.1" 8080
    let! v6 = Net.resolve "::1" 80
    let! shorthand = Net.resolve "127.1" 80
    let! fullwidth = Net.resolve "１２７．０．０．１" 80
    do! IO.writeln (show_resolved v4)
    do! IO.writeln (show_resolved v6)
    do! IO.writeln (show_resolved shorthand)
    do! IO.writeln (show_resolved fullwidth)
    0
```

## `tzroutine` との非ブロッキング統合

`tzroutine { ... }` 内で `connect`・`accept`・`read`・`write`・`recv_from`・`send_to` を呼び出すと、ランタイムの netpoller（macOS は `kqueue`、Linux は `epoll`、Windows は `WSAPoll`）がソケットの準備完了まで当該 tzroutine のみをサスペンドし、ワーカースレッド上で他の tzroutine を実行し続けます。

```tsuzuri run=echoes:%203
def main :: unit -> i32 = \() ->
    let! bound = Net.bind (Maybe.get (Net.parse_address "127.0.0.1:0"))
    let listener = Result.get bound
    let server_addr = Net.local_addr listener
    tzroutine {
        for _ in 0 ..< 3 do
            let! accepted = Net.accept listener Maybe.None
            let stream = Result.get accepted
            tzroutine {
                let! received = Net.read stream 64 Maybe.None
                let! _ = Net.write stream (Result.get received) Maybe.None
                let! _ = Net.close stream
            }
        let! _ = Net.close_listener listener
    }
    let done: Channel<bool> = Channel.make 0
    for i in 0 ..< 3 do
        let out = Channel.share done
        tzroutine {
            let! connected = Net.connect server_addr Maybe.None
            let stream = Result.get connected
            let payload = Array.init 2 (\k -> (i + k) as ubyte)
            let! _ = Net.write stream payload Maybe.None
            let! echoed = Net.read stream 64 Maybe.None
            let! _ = Net.close stream
            Channel.send out (match echoed with
                | Result.Ok bytes -> bytes.length == 2 && bytes[0] == (i as ubyte)
                | Result.Error _ -> false)
        }
    let mut ok_count = 0
    for _ in 0 ..< 3 do
        match Channel.recv done with
        | Maybe.Some true -> ok_count = ok_count + 1
        | _ -> ()
    do! IO.writeln $"echoes: {ok_count}"
    0
```

## 対応環境

| ターゲット環境 | 対応状況 |
| --- | --- |
| Linux x64 / Arm64、macOS Arm64、Windows x64 / Arm64 | 全関数に対応（Windows は Windows 10 2004 以降の Winsock / `WSAPoll`） |
| 既定の `wasm32` / `wasm64` | 純粋なアドレス関数のみ利用可。ソケット関数・`resolve` への到達は `E2000` |
| `wasm32` + `--wasm-host wasi` | ソケット関数・`resolve` への到達は `E2000`（WASI preview1 非対応のため） |
| `wasm32` + `--wasm-feature jspi --wasm-feature net` | Node.js（`node:net`・`node:dgram`・`node:dns`）グルー経由で対応（ブラウザ環境ではロード時エラー） |

## 引数の順序

`Net` モジュールはソケットハンドルを扱うリソースモジュールとして引数順規則の免除対象であり（[標準ライブラリの規約](../conventions.md)）、ストリーム・リスナー・ソケットの各ハンドルを第1引数に置きます（`Net.read stream count timeout`、`Net.send_to socket data target`）。一方、純粋関数の `Net.parse_ip port text` は解析対象の文字列 `text` を最後の引数に取ります。

## 公開 API

### 型定義

```text
record Address // 不透明（opaque）、Copy、Eq、Hash、Display
record TcpStream // 不透明（opaque）、Copy
record TcpListener // 不透明（opaque）、Copy
record UdpSocket // 不透明（opaque）、Copy
union Shutdown = Read | Write | Both // Eq
union ErrorKind = TimedOut | ConnectionRefused | ConnectionReset | AddressInUse | AddressNotAvailable | Unreachable | Unclassified // Eq、Display
```

### アドレス解析・整形・エラー分類・名前解決（8 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Net.parse_address` | `ref string -> Maybe<Net.Address>` | `"127.0.0.1:80"` または `"[::1]:80"` を厳密に解析 |
| `Net.parse_ip` | `own i64 -> ref string -> Maybe<Net.Address>` | ポート番号（`0..=65535`）とポートなし IP 文字列から `Address` を構築 |
| `Net.ip_text` | `own Net.Address -> string` | ポートを除いた IP アドレス文字列（RFC 5952 準拠）を取得 |
| `Net.address_text` | `own Net.Address -> string` | `parse_address` と互換な `"ip:port"` / `"[ipv6]:port"` 文字列を取得 |
| `Net.port` | `own Net.Address -> i64` | ポート番号（`0..=65535`）を取得 |
| `Net.is_ipv6` | `own Net.Address -> bool` | IPv6 アドレスであれば `true` |
| `Net.error_kind` | `own Os.Error -> Net.ErrorKind` | `Os.Error` のエラーコードからネットワークエラー種別を分類 |
| `Net.resolve` | `own string -> own i64 -> IO<Result<[Net.Address], Os.Error>>` | ホスト名とポートから最大 64 件のアドレス配列を解決 |

### TCP ストリーム・リスナー操作（14 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Net.connect` | `own Net.Address -> own Maybe<i64> -> IO<Result<Net.TcpStream, Os.Error>>` | 指定アドレスへ TCP 接続を開く |
| `Net.read` | `own Net.TcpStream -> own i64 -> own Maybe<i64> -> IO<Result<[ubyte], Os.Error>>` | 最大 `count`（`1..=16_777_216`）バイト受信（空配列は EOF） |
| `Net.write` | `own Net.TcpStream -> own [ubyte] -> own Maybe<i64> -> IO<Result<unit, Os.Error>>` | 全バイトを送信し切るまで書き込む |
| `Net.shutdown` | `own Net.TcpStream -> own Net.Shutdown -> IO<Result<unit, Os.Error>>` | ストリームの読み取り・書き込み・双方向を終了 |
| `Net.close` | `own Net.TcpStream -> IO<Result<unit, Os.Error>>` | TCP ストリームを閉じて無効化 |
| `Net.stream_local_addr` | `own Net.TcpStream -> Net.Address` | ストリームのローカル側アドレスを取得 |
| `Net.peer_addr` | `own Net.TcpStream -> Net.Address` | ストリームの接続先ピアアドレスを取得 |
| `Net.bind` | `own Net.Address -> IO<Result<Net.TcpListener, Os.Error>>` | 指定アドレスで TCP リスナーを開始（ポート `0` は自動割当） |
| `Net.accept` | `own Net.TcpListener -> own Maybe<i64> -> IO<Result<Net.TcpStream, Os.Error>>` | 着信 TCP 接続を 1 件受け付ける |
| `Net.local_addr` | `own Net.TcpListener -> Net.Address` | リスナーがバインドしているローカルアドレスを取得 |
| `Net.close_listener` | `own Net.TcpListener -> IO<Result<unit, Os.Error>>` | TCP リスナーを閉じて無効化 |
| `Net.with_connection` | `Capture<'a> => own Net.Address -> own Maybe<i64> -> own (Net.TcpStream -> IO<'a>) -> IO<Result<'a, Os.Error>>` | TCP 接続を開いてコールバックを実行し、復帰前に必ず閉じる |
| `Net.with_listener` | `Capture<'a> => own Net.Address -> own (Net.TcpListener -> IO<'a>) -> IO<Result<'a, Os.Error>>` | TCP リスナーを開いてコールバックを実行し、復帰前に必ず閉じる |
| `Net.with_accepted` | `Capture<'a> => own Net.TcpListener -> own Maybe<i64> -> own (Net.TcpStream -> IO<'a>) -> IO<Result<'a, Os.Error>>` | 接続を 1 件受け付けてコールバックを実行し、ストリームを必ず閉じる |

### UDP ソケット操作（6 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Net.bind_udp` | `own Net.Address -> IO<Result<Net.UdpSocket, Os.Error>>` | 指定アドレスに UDP ソケットをバインド（ポート `0` は自動割当） |
| `Net.send_to` | `own Net.UdpSocket -> own [ubyte] -> own Net.Address -> IO<Result<unit, Os.Error>>` | 1 データグラムを指定アドレスへ送信 |
| `Net.recv_from` | `own Net.UdpSocket -> own i64 -> own Maybe<i64> -> IO<Result<([ubyte] * Net.Address), Os.Error>>` | 最大 `count` バイトの 1 データグラムと送信元アドレスを受信（超過時は破棄して `InvalidInput`） |
| `Net.udp_local_addr` | `own Net.UdpSocket -> Net.Address` | UDP ソケットのローカルアドレスを取得 |
| `Net.close_udp` | `own Net.UdpSocket -> IO<Result<unit, Os.Error>>` | UDP ソケットを閉じて無効化 |
| `Net.with_udp` | `Capture<'a> => own Net.Address -> own (Net.UdpSocket -> IO<'a>) -> IO<Result<'a, Os.Error>>` | UDP ソケットを開いてコールバックを実行し、復帰前に必ず閉じる |

## 関連項目

- [Os](./os.md)
- [IO](./io.md)
- [File](./file.md)
- [Process](./process.md)
- [ErrGroup](../sync/errgroup.md)
- [標準ライブラリの規約](../conventions.md)
- [tzroutine](../../concurrency/tzroutine.md)
- [プラットフォームとクロスコンパイル](../../compiler/platforms.md)
- [WebAssembly](../../compiler/webassembly.md)
