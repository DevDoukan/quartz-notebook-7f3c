<?php
declare(strict_types=1);

// Public entry point for lisans.kalkandlp.com.tr. Keep the SQLite database,
// configuration and signing seed outside this directory.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function reply(int $status, array $value): void {
    http_response_code($status);
    echo json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    if (($_SERVER['HTTPS'] ?? '') === '' || strtolower((string)($_SERVER['HTTPS'] ?? '')) === 'off') reply(400, ['error' => 'HTTPS required']);
    if (($_SERVER['HTTP_HOST'] ?? '') !== 'lisans.kalkandlp.com.tr' || isset($_SERVER['HTTP_ORIGIN']) || isset($_SERVER['HTTP_COOKIE'])) reply(403, ['error' => 'Request rejected']);
    $route = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || !in_array($route, ['/api/v1/server/lease', '/api/v1/admin/command'], true)) reply(404, ['error' => 'Not found']);
    if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') reply(415, ['error' => 'JSON required']);
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    $maxBody = $route === '/api/v1/server/lease' ? 4096 : 8192;
    if ($length < 1 || $length > $maxBody) reply(413, ['error' => 'Request too large']);
    $body = file_get_contents('php://input', false, null, 0, $maxBody + 1);
    if ($body === false || strlen($body) > $maxBody) reply(413, ['error' => 'Request too large']);
    $input = json_decode($body, true, 16, JSON_THROW_ON_ERROR);
    $auth = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
    $match=[];
    if ($route === '/api/v1/server/lease' && !preg_match('/^Bearer ([a-f0-9]{64})$/D', $auth, $match)) reply(401, ['error' => 'Activation rejected']);

    $configPath = getenv('KALKAN_LICENSE_CONFIG') ?: dirname(__DIR__) . '/private/config.php';
    if (!$configPath || !is_file($configPath) || is_link($configPath)) throw new RuntimeException('License service configuration is missing.');
    $config = require $configPath;
    if (!is_array($config) || empty($config['database']) || empty($config['signing_seed'])) throw new RuntimeException('License service configuration is invalid.');
    $publicRoot=realpath(__DIR__);$configReal=realpath($configPath);$seedReal=realpath($config['signing_seed']);$dbParent=realpath(dirname($config['database']));
    if(!$publicRoot||!$configReal||!$seedReal||!$dbParent||str_starts_with($configReal,$publicRoot.DIRECTORY_SEPARATOR)||str_starts_with($seedReal,$publicRoot.DIRECTORY_SEPARATOR)||str_starts_with($dbParent,$publicRoot.DIRECTORY_SEPARATOR))throw new RuntimeException('Private service files must remain outside the public document root.');
    $seed = base64_decode((string)file_get_contents($seedReal), true);
    if ($seed === false || strlen($seed) !== SODIUM_CRYPTO_SIGN_SEEDBYTES) throw new RuntimeException('Signing seed is invalid.');
    $keypair = sodium_crypto_sign_seed_keypair($seed);
    sodium_memzero($seed);
    if(!is_string($config['vendor_public_key']??null)||!hash_equals($config['vendor_public_key'],rtrim(strtr(base64_encode(sodium_crypto_sign_publickey($keypair)),'+/','-_'),'=')))throw new RuntimeException('Signing key does not match the product public key.');
    $secret = sodium_crypto_sign_secretkey($keypair);
    $db = new PDO('sqlite:' . $config['database'], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,server_id TEXT NOT NULL UNIQUE,customer TEXT NOT NULL,device_limit INTEGER NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,document TEXT); CREATE TABLE IF NOT EXISTS activation_failures(id INTEGER PRIMARY KEY CHECK(id=1),count INTEGER NOT NULL,until INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS admin_commands(id TEXT PRIMARY KEY,response TEXT NOT NULL,created INTEGER NOT NULL);');
    if ($route === '/api/v1/admin/command') {
        $b64 = static function ($value): string|false { if (!is_string($value) || !preg_match('/^[A-Za-z0-9_-]+$/D', $value)) return false; return base64_decode(strtr($value, '-_', '+/') . str_repeat('=', (4 - strlen($value) % 4) % 4), true); };
        $payload = $b64($input['payload'] ?? null); $signature = $b64($input['signature'] ?? null);
        if ($payload === false || $signature === false || strlen($payload) > 4096 || strlen($signature) !== SODIUM_CRYPTO_SIGN_BYTES || !sodium_crypto_sign_verify_detached($signature, $payload, sodium_crypto_sign_publickey($keypair))) reply(401, ['error'=>'Command rejected']);
        try { $command = json_decode($payload, true, 12, JSON_THROW_ON_ERROR); } catch (Throwable $e) { reply(400, ['error'=>'Invalid command']); }
        $at=(int)floor(microtime(true)*1000);$issued=strtotime((string)($command['issuedAt']??''))*1000;$expires=strtotime((string)($command['expiresAt']??''))*1000;
        if (!is_array($command) || !is_string($command['id']??null) || !preg_match('/^[a-f0-9-]{36}$/D',$command['id']) || !is_finite((float)$issued) || !is_finite((float)$expires) || $issued>$at+60000 || $expires<$at || $expires-$issued>300000) reply(401,['error'=>'Command rejected']);
        $db->exec('BEGIN IMMEDIATE');
        try {
            $saved=$db->prepare('SELECT response FROM admin_commands WHERE id=?');$saved->execute([$command['id']]);$existing=$saved->fetch();
            if($existing){
                $cached=json_decode($existing['response'],true,8,JSON_THROW_ON_ERROR);
                if(!is_array($cached)||!is_string($cached['nonce']??null)||!is_string($cached['box']??null))throw new RuntimeException('Stored command response is invalid.');
                $nonce=base64_decode(strtr($cached['nonce'],'-_','+/').str_repeat('=',(4-strlen($cached['nonce'])%4)%4),true);
                $box=base64_decode(strtr($cached['box'],'-_','+/').str_repeat('=',(4-strlen($cached['box'])%4)%4),true);
                if($nonce===false||strlen($nonce)!==SODIUM_CRYPTO_SECRETBOX_NONCEBYTES||$box===false)throw new RuntimeException('Stored command response is invalid.');
                $cacheKey=sodium_crypto_generichash('kalkan-license-admin-cache-v1',$secret,SODIUM_CRYPTO_SECRETBOX_KEYBYTES);
                $clear=sodium_crypto_secretbox_open($box,$nonce,$cacheKey);sodium_memzero($cacheKey);
                if($clear===false)throw new RuntimeException('Stored command response authentication failed.');
                $savedResponse=json_decode($clear,true,8,JSON_THROW_ON_ERROR);sodium_memzero($clear);
                $db->exec('COMMIT');reply(200,$savedResponse);
            }
            $action=$command['action']??'';$response=['ok'=>true];
            if($action==='provision'){
                $serverId=$command['serverId']??null;$customer=$command['customer']??null;$limit=$command['deviceLimit']??null;$end=strtotime((string)($command['licenseExpiresAt']??''))*1000;
                if(!is_string($serverId)||!preg_match('/^[a-f0-9-]{36}$/D',$serverId)||!is_string($customer)||trim($customer)===''||strlen($customer)>200||!is_int($limit)||$limit<1||$limit>100000||$end<=$at)throw new RuntimeException('Invalid provision command.');
                $uuid=random_bytes(16);$uuid[6]=chr((ord($uuid[6])&0x0f)|0x40);$uuid[8]=chr((ord($uuid[8])&0x3f)|0x80);$hex=bin2hex($uuid);$id=substr($hex,0,8).'-'.substr($hex,8,4).'-'.substr($hex,12,4).'-'.substr($hex,16,4).'-'.substr($hex,20);$credential=bin2hex(random_bytes(32));
                $stmt=$db->prepare('INSERT INTO grants(id,token_hash,server_id,customer,device_limit,expires) VALUES(?,?,?,?,?,?)');$stmt->execute([$id,hash('sha256',$credential),$serverId,trim($customer),$limit,$end]);$response=['ok'=>true,'licenseId'=>$id,'credential'=>$credential];
            } elseif($action==='revoke') { $stmt=$db->prepare('UPDATE grants SET revoked=1,document=NULL WHERE id=?');$stmt->execute([$command['licenseId']??'']);if(!$stmt->rowCount())throw new RuntimeException('License not found.'); }
            elseif($action==='renew') { $limit=$command['deviceLimit']??null;$end=strtotime((string)($command['licenseExpiresAt']??''))*1000;if(!is_int($limit)||$limit<1||$limit>100000||$end<=$at)throw new RuntimeException('Invalid renewal command.');$stmt=$db->prepare('UPDATE grants SET device_limit=?,expires=?,document=NULL WHERE id=? AND revoked=0');$stmt->execute([$limit,$end,$command['licenseId']??'']);if(!$stmt->rowCount())throw new RuntimeException('Active license not found.'); }
            else throw new RuntimeException('Unknown command.');
            $cacheKey=sodium_crypto_generichash('kalkan-license-admin-cache-v1',$secret,SODIUM_CRYPTO_SECRETBOX_KEYBYTES);$nonce=random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);$box=sodium_crypto_secretbox(json_encode($response,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),$nonce,$cacheKey);sodium_memzero($cacheKey);
            $encode=static fn(string $value):string=>rtrim(strtr(base64_encode($value),'+/','-_'),'=');$cached=json_encode(['nonce'=>$encode($nonce),'box'=>$encode($box)],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
            $stmt=$db->prepare('INSERT INTO admin_commands(id,response,created) VALUES(?,?,?)');$stmt->execute([$command['id'],$cached,$at]);$db->exec('DELETE FROM admin_commands WHERE created < '.($at-86400000));$db->exec('COMMIT');reply(200,$response);
        } catch (Throwable $e) { if($db->inTransaction())$db->exec('ROLLBACK');error_log('Kalkan license admin command rejected: '.$e->getMessage());reply(400,['error'=>'Command rejected']); }
    }
    $reject = static function () use ($db): never {
        $now = (int)floor(microtime(true) * 1000);
        $db->exec('BEGIN IMMEDIATE');
        try {
            $row = $db->query('SELECT count,until FROM activation_failures WHERE id=1')->fetch();
            if ($row && (int)$row['until'] > $now && (int)$row['count'] >= 20) { $db->exec('ROLLBACK'); reply(429, ['error' => 'Activation rejected']); }
            $count = $row && (int)$row['until'] > $now ? (int)$row['count'] + 1 : 1;
            $until = $row && (int)$row['until'] > $now ? (int)$row['until'] : $now + 900000;
            $stmt = $db->prepare('INSERT INTO activation_failures VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET count=excluded.count,until=excluded.until');
            $stmt->execute([$count, $until]);
            $db->exec('COMMIT');
        } catch (Throwable $e) { if ($db->inTransaction()) $db->exec('ROLLBACK'); throw $e; }
        reply(401, ['error' => 'Activation rejected']);
    };
    if (!is_array($input) || ($input['schema'] ?? null) !== 1 || ($input['product'] ?? null) !== 'kalkan-dlp-server' || !is_string($input['serverId'] ?? null) || !preg_match('/^[a-f0-9-]{36}$/D', $input['serverId']) || !is_int($input['revision'] ?? null) || $input['revision'] < 0) $reject();
    $tokenHash = hash('sha256', $match[1]);
    $stmt = $db->prepare('SELECT server_id,revision FROM grants WHERE token_hash=?');
    $stmt->execute([$tokenHash]);
    $known = $stmt->fetch();
    if (!$known || !hash_equals((string)$known['server_id'], $input['serverId']) || $input['revision'] > (int)$known['revision']) $reject();

    $db->exec('BEGIN IMMEDIATE');
    try {
        $stmt = $db->prepare('SELECT * FROM grants WHERE token_hash=?'); $stmt->execute([$tokenHash]); $grant = $stmt->fetch();
        if (!$grant || !hash_equals((string)$grant['server_id'], $input['serverId']) || $input['revision'] > (int)$grant['revision']) { $db->exec('ROLLBACK'); $reject(); }
        $now = (int)floor(microtime(true) * 1000);
        if ($grant['document'] !== null) {
            $saved = json_decode($grant['document'], true, 8, JSON_THROW_ON_ERROR);
            $old = json_decode(base64_decode(strtr($saved['payload'], '-_', '+/')), true, 8, JSON_THROW_ON_ERROR);
            if (strtotime($old['issuedAt']) * 1000 > $now + 60000) throw new RuntimeException('Clock validation failed.');
            if (strtotime($old['expiresAt']) * 1000 > $now + 3600000) { $db->exec('COMMIT'); reply(200, $saved); }
        }
        $active = !(bool)$grant['revoked'] && (int)$grant['expires'] > $now;
        $expires = $active ? min((int)$grant['expires'], $now + 86400000) : $now + 86400000;
        $claims = ['schema'=>1,'product'=>'kalkan-dlp-server','serverId'=>$grant['server_id'],'licenseId'=>$grant['id'],'customer'=>$grant['customer'],'revision'=>(int)$grant['revision']+1,'deviceLimit'=>(int)$grant['device_limit'],'state'=>$active?'active':'revoked','issuedAt'=>gmdate('Y-m-d\TH:i:s\Z',(int)floor($now/1000)),'expiresAt'=>gmdate('Y-m-d\TH:i:s\Z',(int)floor($expires/1000))];
        $raw = json_encode($claims, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $document = ['payload'=>rtrim(strtr(base64_encode($raw), '+/', '-_'), '='),'signature'=>rtrim(strtr(base64_encode(sodium_crypto_sign_detached($raw, $secret)), '+/', '-_'), '=')];
        $stmt = $db->prepare('UPDATE grants SET revision=?,document=? WHERE id=?'); $stmt->execute([$claims['revision'], json_encode($document, JSON_UNESCAPED_SLASHES), $grant['id']]);
        $db->exec('COMMIT');
        reply(200, $document);
    } catch (Throwable $e) { if ($db->inTransaction()) $db->exec('ROLLBACK'); throw $e; }
} catch (JsonException $e) { reply(400, ['error' => 'Invalid JSON']); }
  catch (Throwable $e) { error_log('Kalkan license service failure: ' . $e->getMessage()); reply(503, ['error' => 'Service unavailable']); }
