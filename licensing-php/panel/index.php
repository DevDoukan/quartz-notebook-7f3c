<?php
declare(strict_types=1);

// License administration for panel.kalkandlp.com.tr. Keep configuration and
// SQLite data outside this subdomain's document root.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Cross-Origin-Resource-Policy: same-origin');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'");

function answer(int $status, array $body): never {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

try {
    if (($_SERVER['HTTPS'] ?? '') === '' || strtolower((string)($_SERVER['HTTPS'] ?? '')) === 'off') answer(400, ['error'=>'HTTPS required']);
    if (($_SERVER['HTTP_HOST'] ?? '') !== 'panel.kalkandlp.com.tr') answer(403, ['error'=>'Request rejected']);
    $route = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    if (!is_string($route) || !str_starts_with($route, '/api/panel/')) answer(404, ['error'=>'Not found']);
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    $allowed = ['/api/panel/status','/api/panel/bootstrap','/api/panel/login','/api/panel/logout','/api/panel/licenses','/api/panel/provision','/api/panel/renew','/api/panel/revoke'];
    if (!in_array($route, $allowed, true)) answer(404, ['error'=>'Not found']);
    if (in_array($route, ['/api/panel/status','/api/panel/licenses'], true) && $method !== 'GET') answer(405, ['error'=>'Method not allowed']);
    if (!in_array($route, ['/api/panel/status','/api/panel/licenses'], true) && $method !== 'POST') answer(405, ['error'=>'Method not allowed']);
    $configPath = getenv('KALKAN_LICENSE_CONFIG') ?: dirname(__DIR__) . '/private/panel-config.php';
    if (!is_file($configPath) || is_link($configPath)) throw new RuntimeException('Panel configuration is missing.');
    $config = require $configPath;
    if (!is_array($config) || empty($config['database']) || empty($config['setup_token_hash'])) throw new RuntimeException('Panel configuration is invalid.');
    $panelRoot = realpath(__DIR__); $configReal = realpath($configPath); $dbParent = realpath(dirname($config['database']));
    if (!$panelRoot || !$configReal || !$dbParent || str_starts_with($configReal, $panelRoot . DIRECTORY_SEPARATOR) || str_starts_with($dbParent, $panelRoot . DIRECTORY_SEPARATOR)) throw new RuntimeException('Private files must remain outside the panel document root.');
    $db = new PDO('sqlite:' . $config['database'], null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS panel_users(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL,password_hash TEXT NOT NULL,created INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS panel_sessions(token_hash TEXT PRIMARY KEY,csrf_hash TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS panel_login_attempts(id INTEGER PRIMARY KEY CHECK(id=1),count INTEGER NOT NULL,until INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,server_id TEXT NOT NULL UNIQUE,customer TEXT NOT NULL,device_limit INTEGER NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,document TEXT);');
    $input = [];
    if ($method === 'POST') {
        $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($length < 1 || $length > 8192 || strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') answer(413, ['error'=>'Invalid request']);
        $raw = file_get_contents('php://input', false, null, 0, 8193);
        if ($raw === false || strlen($raw) > 8192) answer(413, ['error'=>'Invalid request']);
        $input = json_decode($raw, true, 12, JSON_THROW_ON_ERROR);
        if (!is_array($input)) answer(400, ['error'=>'Invalid request']);
    }
    $cookie = (string)($_COOKIE['__Host-kalkan-panel'] ?? '');
    $session = null;
    if (preg_match('/^[a-f0-9]{64}$/D', $cookie)) {
        $stmt=$db->prepare('SELECT s.token_hash,s.csrf_hash,s.expires,u.username FROM panel_sessions s JOIN panel_users u ON u.id=1 WHERE s.token_hash=? AND s.expires>?');
        $stmt->execute([hash('sha256',$cookie),(int)floor(microtime(true)*1000)]); $session=$stmt->fetch() ?: null;
    }
    if ($route === '/api/panel/status') {
        if (!$session) answer(200,['setupRequired'=>!(bool)$db->query('SELECT 1 FROM panel_users WHERE id=1')->fetchColumn(),'authenticated'=>false]);
        $csrf=bin2hex(random_bytes(32)); $stmt=$db->prepare('UPDATE panel_sessions SET csrf_hash=? WHERE token_hash=?');$stmt->execute([hash('sha256',$csrf),$session['token_hash']]);
        answer(200,['setupRequired'=>false,'authenticated'=>true,'username'=>$session['username'],'csrf'=>$csrf]);
    }
    if ($route === '/api/panel/bootstrap') {
        if ($session || $db->query('SELECT 1 FROM panel_users WHERE id=1')->fetchColumn()) answer(409,['error'=>'Panel is already initialized.']);
        $token=(string)($input['setupToken']??'');$username=trim((string)($input['username']??''));$password=(string)($input['password']??'');
        if (!preg_match('/^[a-f0-9]{40,128}$/D',$token)||!hash_equals((string)$config['setup_token_hash'],hash('sha256',$token))||!preg_match('/^[a-zA-Z0-9._-]{3,40}$/D',$username)||strlen($password)<14||strlen($password)>200) answer(401,['error'=>'İlk kurulum bilgileri geçersiz.']);
        $db->exec('BEGIN IMMEDIATE');try{$db->prepare('INSERT INTO panel_users(id,username,password_hash,created) VALUES(1,?,?,?)')->execute([$username,password_hash($password,PASSWORD_DEFAULT),(int)floor(microtime(true)*1000)]);$db->exec('COMMIT');}catch(Throwable $e){if($db->inTransaction())$db->exec('ROLLBACK');answer(409,['error'=>'Panel kurulumu tamamlanamadı.']);}
        $route='/api/panel/login'; $input=['username'=>$username,'password'=>$password];
    }
    if ($route === '/api/panel/login') {
        $now=(int)floor(microtime(true)*1000);$attempt=$db->query('SELECT count,until FROM panel_login_attempts WHERE id=1')->fetch();
        if ($attempt && (int)$attempt['until']>$now && (int)$attempt['count']>=12) answer(429,['error'=>'Çok fazla deneme. Bir süre sonra tekrar deneyin.']);
        $stmt=$db->prepare('SELECT username,password_hash FROM panel_users WHERE id=1');$stmt->execute();$user=$stmt->fetch();
        if (!$user || !password_verify((string)($input['password']??''),$user['password_hash']) || !hash_equals($user['username'],(string)($input['username']??''))) {
            $count=$attempt&&(int)$attempt['until']>$now?(int)$attempt['count']+1:1;$until=$attempt&&(int)$attempt['until']>$now?(int)$attempt['until']:$now+900000;$db->prepare('INSERT INTO panel_login_attempts VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET count=excluded.count,until=excluded.until')->execute([$count,$until]);answer(401,['error'=>'Kullanıcı adı veya parola hatalı.']);
        }
        $db->exec('DELETE FROM panel_login_attempts WHERE id=1');$token=bin2hex(random_bytes(32));$csrf=bin2hex(random_bytes(32));$expiry=$now+28800000;$db->prepare('INSERT INTO panel_sessions(token_hash,csrf_hash,expires) VALUES(?,?,?)')->execute([hash('sha256',$token),hash('sha256',$csrf),$expiry]);
        setcookie('__Host-kalkan-panel',$token,['expires'=>(int)floor($expiry/1000),'path'=>'/','secure'=>true,'httponly'=>true,'samesite'=>'Strict']);answer(200,['authenticated'=>true,'username'=>$user['username'],'csrf'=>$csrf]);
    }
    if (!$session) answer(401,['error'=>'Oturum açmanız gerekiyor.']);
    if (!hash_equals($session['csrf_hash'],hash('sha256',(string)($_SERVER['HTTP_X_CSRF_TOKEN']??'')))) answer(403,['error'=>'İstek doğrulanamadı. Sayfayı yenileyip tekrar deneyin.']);
    if ($route === '/api/panel/logout') { $db->prepare('DELETE FROM panel_sessions WHERE token_hash=?')->execute([$session['token_hash']]);setcookie('__Host-kalkan-panel','',['expires'=>1,'path'=>'/','secure'=>true,'httponly'=>true,'samesite'=>'Strict']);answer(200,['ok'=>true]); }
    if ($route === '/api/panel/licenses') {
        $rows=$db->query('SELECT id,server_id,customer,device_limit,expires,revoked,revision FROM grants ORDER BY expires DESC LIMIT 500')->fetchAll();answer(200,['licenses'=>$rows]);
    }
    if ($route === '/api/panel/provision') {
        $serverId=$input['serverId']??null;$customer=trim((string)($input['customer']??''));$limit=$input['deviceLimit']??null;$expires=strtotime((string)($input['expiresAt']??''));
        if (!is_string($serverId)||!preg_match('/^[a-f0-9-]{36}$/D',$serverId)||$customer===''||strlen($customer)>200||!is_int($limit)||$limit<1||$limit>100000||$expires===false||$expires*1000<=(int)floor(microtime(true)*1000)) answer(400,['error'=>'Lisans alanlarını kontrol edin.']);
        $credential=bin2hex(random_bytes(32));$id=sprintf('%s-%s-%s-%s-%s',bin2hex(random_bytes(4)),bin2hex(random_bytes(2)),bin2hex(random_bytes(2)),bin2hex(random_bytes(2)),bin2hex(random_bytes(6)));
        try{$db->prepare('INSERT INTO grants(id,token_hash,server_id,customer,device_limit,expires) VALUES(?,?,?,?,?,?)')->execute([$id,hash('sha256',$credential),$serverId,$customer,$limit,$expires*1000]);}catch(Throwable $e){answer(409,['error'=>'Server kimliği daha önce lisanslanmış olabilir.']);}
        answer(201,['license'=>['id'=>$id,'serverId'=>$serverId,'customer'=>$customer,'deviceLimit'=>$limit,'expires'=>$expires*1000,'revoked'=>0,'revision'=>0],'credential'=>$credential]);
    }
    $licenseId=(string)($input['licenseId']??'');if(!preg_match('/^[a-f0-9-]{36}$/D',$licenseId))answer(400,['error'=>'Lisans numarası geçersiz.']);
    if($route==='/api/panel/revoke'){$stmt=$db->prepare('UPDATE grants SET revoked=1,document=NULL WHERE id=?');$stmt->execute([$licenseId]);if($stmt->rowCount()===0)answer(404,['error'=>'Lisans bulunamadı.']);answer(200,['ok'=>true]);}
    if($route==='/api/panel/renew'){$limit=$input['deviceLimit']??null;$expires=strtotime((string)($input['expiresAt']??''));if(!is_int($limit)||$limit<1||$limit>100000||$expires===false||$expires*1000<=(int)floor(microtime(true)*1000))answer(400,['error'=>'Yenileme alanlarını kontrol edin.']);$stmt=$db->prepare('UPDATE grants SET device_limit=?,expires=?,document=NULL WHERE id=? AND revoked=0');$stmt->execute([$limit,$expires*1000,$licenseId]);if($stmt->rowCount()===0)answer(404,['error'=>'Etkin lisans bulunamadı.']);answer(200,['ok'=>true]);}
    answer(404,['error'=>'Not found']);
} catch (Throwable $e) {
    error_log('Kalkan panel request failed: '.$e->getMessage());
    answer(500,['error'=>'Panel isteği tamamlanamadı.']);
}
