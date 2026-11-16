<?php
$private = dirname(__DIR__) . '/private';
return [
    'database' => $private . '/kalkan-licenses.sqlite',
    'signing_seed' => $private . '/vendor-signing.seed',
    'vendor_public_key' => trim((string)file_get_contents(__DIR__ . '/../vendor-public.key')),
];
