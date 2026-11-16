#ifndef KALKAN_PROTOCOL_H
#define KALKAN_PROTOCOL_H
#define KALKAN_PROTOCOL_VERSION 2u
#define KALKAN_RESULT_PARSER_COMPLETE 1ULL
#define KALKAN_HELLO 1u
#define KALKAN_SCAN_REPLY 2u
#define KALKAN_QUERY_STATUS 3u
#define KALKAN_SCAN_REQUEST_COMMAND 4u
#define KALKAN_MAX_SCAN_CHUNK 65536u
#define KALKAN_MAX_SCAN_FILE (10ULL * 1024 * 1024)
#define KALKAN_SCAN_BUDGET_100NS 20000000ULL
#define KALKAN_MAX_INFLIGHT_SCANS 8
static __inline unsigned __int64 KalkanScanBudgetRemaining(unsigned __int64 started, unsigned __int64 now)
{
    if (now < started || now - started >= KALKAN_SCAN_BUDGET_100NS) return 0;
    return KALKAN_SCAN_BUDGET_100NS - (now - started);
}
static __inline int KalkanScanDeadlineExpired(unsigned __int64 started, unsigned __int64 finished)
{
    return finished < started || finished - started >= KALKAN_SCAN_BUDGET_100NS;
}
#define KALKAN_DECISION_ALLOW 1u
#define KALKAN_DECISION_BLOCK 2u
#define KALKAN_PORT_NAME L"\\KalkanDlpPort"
typedef struct _KALKAN_HELLO_MESSAGE {
    unsigned long Version;
    unsigned long Size;
    unsigned long Command;
    unsigned long Reserved;
} KALKAN_HELLO_MESSAGE;
typedef char KALKAN_ASSERT_HELLO_SIZE[(sizeof(KALKAN_HELLO_MESSAGE) == 16) ? 1 : -1];
typedef struct _KALKAN_STATUS_RESULT {
    unsigned long Version;
    unsigned long Size;
    unsigned long Command;
    unsigned long ProtectionActive;
    unsigned __int64 MutationEpoch;
    long ActiveMutations;
    unsigned long WritableSectionsSeen;
} KALKAN_STATUS_RESULT;
typedef char KALKAN_ASSERT_STATUS_SIZE[(sizeof(KALKAN_STATUS_RESULT) == 32) ? 1 : -1];
static __inline int KalkanValidStatus(const KALKAN_STATUS_RESULT *value, unsigned long size)
{
    return value != 0 && size == sizeof(*value) && value->Size == sizeof(*value) &&
        value->Version == KALKAN_PROTOCOL_VERSION && value->Command == KALKAN_QUERY_STATUS &&
        value->ProtectionActive == 0 && value->MutationEpoch != 0 &&
        value->ActiveMutations >= 0 && value->WritableSectionsSeen <= 1;
}
typedef struct _KALKAN_SCAN_RESULT {
    unsigned long Version;
    unsigned long Size;
    unsigned long Command;
    unsigned long Decision;
    unsigned __int64 RequestId;
    unsigned __int64 PolicyRevision;
    unsigned __int64 ContentGeneration;
    unsigned __int64 Flags;
} KALKAN_SCAN_RESULT;
typedef char KALKAN_ASSERT_RESULT_SIZE[(sizeof(KALKAN_SCAN_RESULT) == 48) ? 1 : -1];
typedef struct _KALKAN_SCAN_REQUEST {
    unsigned long Version;
    unsigned long Size;
    unsigned long Command;
    unsigned long ContentLength;
    unsigned __int64 RequestId;
    unsigned __int64 PolicyRevision;
    unsigned __int64 ContentGeneration;
    unsigned __int64 VolumeSerial;
    unsigned char FileId[16];
    unsigned __int64 Offset;
    unsigned __int64 FileSize;
} KALKAN_SCAN_REQUEST;
typedef char KALKAN_ASSERT_REQUEST_SIZE[(sizeof(KALKAN_SCAN_REQUEST) == 80) ? 1 : -1];
/* Header plus bounded content. Partial chunks never constitute a whole-file
   clean verdict; the eventual scanner must retain parse and coverage state. */
static __inline int KalkanValidScanRequest(const KALKAN_SCAN_REQUEST *request, unsigned long received)
{
    unsigned long i;
    unsigned char identity = 0;
    if (request == 0 || received < sizeof(*request)) return 0;
    if (request->Version != KALKAN_PROTOCOL_VERSION || request->Command != KALKAN_SCAN_REQUEST_COMMAND ||
        request->ContentLength > KALKAN_MAX_SCAN_CHUNK || request->Size != received ||
        received != sizeof(*request) + request->ContentLength || request->RequestId == 0 ||
        request->PolicyRevision == 0 || request->ContentGeneration == 0 ||
        request->FileSize > KALKAN_MAX_SCAN_FILE || request->Offset > request->FileSize || request->ContentLength > request->FileSize - request->Offset) return 0;
    for (i = 0; i < sizeof(request->FileId); ++i) identity |= request->FileId[i];
    return identity != 0;
}
/* A transport timeout is not a successful response. Caller must explicitly
   pass the raw NTSTATUS value, not NT_SUCCESS(status). */
static __inline int KalkanValidScanResult(const KALKAN_SCAN_RESULT *result,
    unsigned long size, long transportStatus, int deadlineExpired,
    unsigned __int64 requestId, unsigned __int64 revision, unsigned __int64 generation)
{
    return transportStatus == 0 && deadlineExpired == 0 && result != 0 &&
        requestId != 0 && revision != 0 && size == sizeof(*result) &&
        result->Version == KALKAN_PROTOCOL_VERSION && result->Size == sizeof(*result) &&
        result->Command == KALKAN_SCAN_REPLY && (result->Flags & ~KALKAN_RESULT_PARSER_COMPLETE) == 0 &&
        (result->Decision == KALKAN_DECISION_ALLOW || result->Decision == KALKAN_DECISION_BLOCK) &&
        result->RequestId == requestId && result->PolicyRevision == revision &&
        result->ContentGeneration == generation;
}
/* Call only on a captured local copy, never directly on a user pointer. */
static __inline int KalkanValidHello(const KALKAN_HELLO_MESSAGE *hello, unsigned long size)
{
    return hello != 0 && size == sizeof(*hello) &&
        hello->Version == KALKAN_PROTOCOL_VERSION && hello->Size == sizeof(*hello) &&
        hello->Command == KALKAN_HELLO && hello->Reserved == 0;
}
#endif
