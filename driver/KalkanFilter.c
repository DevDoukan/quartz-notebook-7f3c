#include <fltKernel.h>
#include "KalkanProtocol.h"
#include "KalkanCoverage.h"
#include "KalkanStorage.h"
#include "KalkanPolicy.h"
#include "KalkanIoGate.h"
#include "KalkanScanContext.h"
#include "KalkanCreate.h"
#include "KalkanReadCache.h"
C_ASSERT(sizeof(FILE_FS_DEVICE_INFORMATION) == 8);
C_ASSERT(FILE_PORTABLE_DEVICE == 0x40000);
C_ASSERT(FILE_REMOVABLE_MEDIA == 1);
C_ASSERT(FILE_REMOTE_DEVICE == 0x10);
C_ASSERT(FILE_OPEN == 1);
C_ASSERT(FILE_DELETE_ON_CLOSE == 0x1000);
C_ASSERT((FILE_READ_DATA | FILE_READ_EA | FILE_EXECUTE | FILE_READ_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE | GENERIC_READ | GENERIC_EXECUTE) == 0xa01200a9u);

/* Development filter. Normal reads have scoped enforcement below; mapped
   access, full channel coverage and loaded-driver acceptance remain pending. */
static PFLT_FILTER Filter;
static PFLT_PORT ServerPort;
static PFLT_PORT ClientPort;
/* Global counters below are diagnostic only. Scan admission uses its own
   instance gate and generation, unaffected by unrelated local volumes. */
static volatile LONG64 MutationEpoch = 1;
static volatile LONG ActiveMutations;
static volatile LONG WritableSectionsSeen;
static volatile LONG InflightScans;
static volatile LONG InflightInspections;
static EX_RUNDOWN_REF ScanRundown;
static volatile LONG64 NextScanId;
static KSPIN_LOCK PolicyLock;
static KALKAN_POLICY_STATE PolicyState;
static ULONGLONG PolicyRefreshedAt;
typedef struct _KALKAN_INSTANCE_STATE {
    ULONG StorageClass;
    KSPIN_LOCK IoLock;
    KALKAN_IO_GATE Gate;
} KALKAN_INSTANCE_STATE;
static NTSTATUS InstanceSetup(PCFLT_RELATED_OBJECTS Objects, FLT_INSTANCE_SETUP_FLAGS Flags,
    DEVICE_TYPE VolumeDeviceType, FLT_FILESYSTEM_TYPE FileSystemType)
{
    FLT_VOLUME_PROPERTIES properties = {0};
    KALKAN_INSTANCE_STATE *state = NULL;
    ULONG returned = 0;
    NTSTATUS status, setStatus;
    UNREFERENCED_PARAMETER(Flags); UNREFERENCED_PARAMETER(VolumeDeviceType); UNREFERENCED_PARAMETER(FileSystemType);
    /* This API is safe during mount. BUFFER_OVERFLOW still returns its fixed
       fields; device-name strings are intentionally neither allocated nor used. */
    status = FltGetVolumeProperties(Objects->Volume, &properties, sizeof(properties), &returned);
    setStatus = FltAllocateContext(Filter, FLT_INSTANCE_CONTEXT, sizeof(*state), NonPagedPoolNx, (PFLT_CONTEXT *)&state);
    if (!NT_SUCCESS(setStatus)) return STATUS_FLT_DO_NOT_ATTACH;
    RtlZeroMemory(&state->Gate, sizeof(state->Gate));
    state->Gate.Generation = 1;
    KeInitializeSpinLock(&state->IoLock);
    state->StorageClass = KalkanClassifyVolume(
        (status == STATUS_SUCCESS || status == STATUS_BUFFER_OVERFLOW) ? STATUS_SUCCESS : status,
        (status == STATUS_SUCCESS || status == STATUS_BUFFER_OVERFLOW) ? 8 : 0,
        properties.DeviceType, properties.DeviceCharacteristics);
    setStatus = FltSetInstanceContext(Objects->Instance, FLT_SET_CONTEXT_KEEP_IF_EXISTS, state, NULL);
    FltReleaseContext(state);
    return NT_SUCCESS(setStatus) || setStatus == STATUS_FLT_CONTEXT_ALREADY_DEFINED ? STATUS_SUCCESS : STATUS_FLT_DO_NOT_ATTACH;
}
static BOOLEAN ScopedInstance(const KALKAN_INSTANCE_STATE *state)
{
    return state->StorageClass == KALKAN_STORAGE_PORTABLE || state->StorageClass == KALKAN_STORAGE_REMOVABLE_MEDIA;
}
static NTSTATUS BeginVolumeMutation(PCFLT_RELATED_OBJECTS Objects, BOOLEAN Mapped, PVOID *Completion)
{
    KALKAN_INSTANCE_STATE *state = NULL;
    KIRQL oldIrql;
    int accepted;
    *Completion = NULL;
    if (!NT_SUCCESS(FltGetInstanceContext(Objects->Instance, (PFLT_CONTEXT *)&state))) return STATUS_SUCCESS;
    if (!ScopedInstance(state)) { FltReleaseContext(state); return STATUS_SUCCESS; }
    KeAcquireSpinLock(&state->IoLock, &oldIrql);
    accepted = KalkanBeginMutation(&state->Gate, Mapped);
    KeReleaseSpinLock(&state->IoLock, oldIrql);
    if (!accepted) { FltReleaseContext(state); return STATUS_SHARING_VIOLATION; }
    *Completion = state; /* Reference survives until the post-operation. */
    return STATUS_SUCCESS;
}
static VOID EndVolumeMutation(PVOID Completion)
{
    KALKAN_INSTANCE_STATE *state = Completion;
    KIRQL oldIrql;
    if (!state) return;
    KeAcquireSpinLock(&state->IoLock, &oldIrql);
    KalkanEndMutation(&state->Gate);
    KeReleaseSpinLock(&state->IoLock, oldIrql);
    FltReleaseContext(state);
}
static ULONGLONG ReadGeneration(PFLT_INSTANCE Instance)
{
    KALKAN_INSTANCE_STATE *state = NULL;
    KIRQL oldIrql;
    ULONGLONG generation;
    if (!NT_SUCCESS(FltGetInstanceContext(Instance, (PFLT_CONTEXT *)&state))) return 0;
    KeAcquireSpinLock(&state->IoLock, &oldIrql);
    generation = KalkanReadGeneration(&state->Gate);
    KeReleaseSpinLock(&state->IoLock, oldIrql);
    FltReleaseContext(state);
    return generation;
}
NTSTATUS KalkanPrepareScanRequest(PFLT_INSTANCE Instance, PFILE_OBJECT FileObject,
    ULONGLONG PolicyRevision, KALKAN_SCAN_REQUEST *Request);
NTSTATUS KalkanPrepareScanRequest(PFLT_INSTANCE Instance, PFILE_OBJECT FileObject,
    ULONGLONG PolicyRevision, KALKAN_SCAN_REQUEST *Request)
{
    FILE_STANDARD_INFORMATION standard = {0};
    FILE_ID_INFORMATION identity = {0};
    ULONGLONG epoch;
    LONG64 id;
    ULONG returned = 0;
    NTSTATUS status;
    if (Request == NULL) return STATUS_INVALID_PARAMETER;
    RtlZeroMemory(Request, sizeof(*Request));
    if (Instance == NULL || FileObject == NULL || PolicyRevision == 0 ||
        KeGetCurrentIrql() != PASSIVE_LEVEL || KeAreAllApcsDisabled() || IoGetTopLevelIrp() != NULL)
        return STATUS_INVALID_PARAMETER;
    epoch = ReadGeneration(Instance);
    if (!epoch) return STATUS_RETRY;
    status = FltQueryInformationFile(Instance, FileObject, &identity, sizeof(identity), FileIdInformation, &returned);
    if (!NT_SUCCESS(status) || returned != sizeof(identity)) return STATUS_NOT_SUPPORTED;
    status = FltQueryInformationFile(Instance, FileObject, &standard, sizeof(standard), FileStandardInformation, NULL);
    if (!NT_SUCCESS(status)) return status;
    if (standard.Directory || standard.DeletePending || standard.EndOfFile.QuadPart < 0) return STATUS_FILE_INVALID;
    if (ReadGeneration(Instance) != epoch) return STATUS_RETRY;
    id = InterlockedIncrement64(&NextScanId);
    if (id <= 0) return STATUS_INTEGER_OVERFLOW;
    Request->Version = KALKAN_PROTOCOL_VERSION;
    Request->Size = sizeof(*Request);
    Request->Command = KALKAN_SCAN_REQUEST_COMMAND;
    Request->RequestId = (ULONGLONG)id;
    Request->PolicyRevision = PolicyRevision;
    Request->ContentGeneration = (ULONGLONG)epoch;
    Request->VolumeSerial = identity.VolumeSerialNumber;
    RtlCopyMemory(Request->FileId, &identity.FileId, sizeof(Request->FileId));
    Request->FileSize = (ULONGLONG)standard.EndOfFile.QuadPart;
    return STATUS_SUCCESS;
}
/* Caller supplies an owned, immutable nonpaged header+content buffer and holds
   the file/instance lifetime. Not yet called by file callbacks. */
NTSTATUS KalkanSendScanRequest(PFLT_INSTANCE Instance, const KALKAN_SCAN_REQUEST *Request, ULONG Bytes, ULONGLONG Started, KALKAN_SCAN_RESULT *Result);
NTSTATUS KalkanSendScanRequest(PFLT_INSTANCE Instance, const KALKAN_SCAN_REQUEST *Request, ULONG Bytes, ULONGLONG Started, KALKAN_SCAN_RESULT *Result)
{
    KALKAN_SCAN_RESULT reply;
    LARGE_INTEGER timeout;
    ULONG replyBytes = sizeof(reply);
    ULONGLONG remaining;
    NTSTATUS status;
    if (Result == NULL) return STATUS_INVALID_PARAMETER;
    RtlZeroMemory(Result, sizeof(*Result));
    Result->Decision = KALKAN_DECISION_BLOCK;
    if (KeGetCurrentIrql() != PASSIVE_LEVEL || KeAreAllApcsDisabled() || IoGetTopLevelIrp() != NULL)
        return STATUS_INVALID_DEVICE_STATE;
    if (Bytes > sizeof(KALKAN_SCAN_REQUEST) + KALKAN_MAX_SCAN_CHUNK ||
        !KalkanValidScanRequest(Request, Bytes)) return STATUS_INVALID_PARAMETER;
    if (Instance == NULL || ReadGeneration(Instance) != Request->ContentGeneration)
        return STATUS_RETRY;
    RtlZeroMemory(&reply, sizeof(reply));
    if (!ExAcquireRundownProtection(&ScanRundown)) return STATUS_DELETE_PENDING;
    if (InterlockedIncrement(&InflightScans) > KALKAN_MAX_INFLIGHT_SCANS) {
        InterlockedDecrement(&InflightScans);
        ExReleaseRundownProtection(&ScanRundown);
        return STATUS_DEVICE_BUSY;
    }
    /* Every chunk consumes the same whole-file budget. Never restart a
       two-second allowance after reading or after a preceding reply. */
    remaining = KalkanScanBudgetRemaining(Started, KeQueryInterruptTime());
    if (remaining == 0) {
        InterlockedDecrement(&InflightScans);
        ExReleaseRundownProtection(&ScanRundown);
        return STATUS_TIMEOUT;
    }
    timeout.QuadPart = -(LONGLONG)remaining;
    status = FltSendMessage(Filter, &ClientPort, (PVOID)Request, Bytes,
        &reply, &replyBytes, &timeout);
    InterlockedDecrement(&InflightScans);
    /* STATUS_TIMEOUT is nonnegative: NT_SUCCESS alone is insufficient. */
    if (status != STATUS_SUCCESS) goto SendComplete;
    if (KalkanScanDeadlineExpired(Started, KeQueryInterruptTime())) { status = STATUS_TIMEOUT; goto SendComplete; }
    /* FltMgr consumes FILTER_REPLY_HEADER; kernel receives the payload only,
       as demonstrated by Microsoft's Scanner sample. */
    if (replyBytes != sizeof(reply) ||
        !KalkanValidScanResult(&reply, replyBytes, status, 0,
            Request->RequestId, Request->PolicyRevision, Request->ContentGeneration))
        { status = STATUS_DATA_ERROR; goto SendComplete; }
    if (ReadGeneration(Instance) != Request->ContentGeneration)
        { status = STATUS_RETRY; goto SendComplete; }
    *Result = reply;
SendComplete:
    ExReleaseRundownProtection(&ScanRundown);
    return status;
}
/* Reads require an active instance admission and stable instance generation. */
NTSTATUS KalkanReadChunk(PFLT_INSTANCE Instance, PFILE_OBJECT FileObject,
    KALKAN_SCAN_REQUEST *Request, PVOID Content, ULONG Capacity);
NTSTATUS KalkanReadChunk(PFLT_INSTANCE Instance, PFILE_OBJECT FileObject,
    KALKAN_SCAN_REQUEST *Request, PVOID Content, ULONG Capacity)
{
    FILE_STANDARD_INFORMATION before = {0}, after = {0};
    FILE_ID_INFORMATION identity = {0};
    LARGE_INTEGER offset;
    ULONG returned = 0, read = 0;
    ULONGLONG epoch;
    NTSTATUS status;
    if (Request == NULL || Content == NULL || Instance == NULL || FileObject == NULL ||
        Capacity == 0 || Capacity > KALKAN_MAX_SCAN_CHUNK ||
        Request->Offset > MAXLONGLONG || KeGetCurrentIrql() != PASSIVE_LEVEL ||
        KeAreAllApcsDisabled() || IoGetTopLevelIrp() != NULL ||
        (FileObject->Flags & FO_NO_INTERMEDIATE_BUFFERING)) return STATUS_INVALID_PARAMETER;
    /* Caller owns these buffers and serializes access. An error invalidates
       all content; the caller must not send it as a successful scan. */
    RtlZeroMemory(Content, Capacity);
    Request->ContentLength = 0;
    Request->Size = sizeof(*Request);
    epoch = ReadGeneration(Instance);
    if (!epoch || epoch != Request->ContentGeneration)
        return STATUS_RETRY;
    status = FltQueryInformationFile(Instance, FileObject, &identity, sizeof(identity), FileIdInformation, &returned);
    if (!NT_SUCCESS(status) || returned != sizeof(identity)) return STATUS_NOT_SUPPORTED;
    if (identity.VolumeSerialNumber != Request->VolumeSerial ||
        RtlCompareMemory(&identity.FileId, Request->FileId, sizeof(identity.FileId)) != sizeof(identity.FileId))
        return STATUS_FILE_INVALID;
    status = FltQueryInformationFile(Instance, FileObject, &before, sizeof(before), FileStandardInformation, NULL);
    if (!NT_SUCCESS(status)) return status;
    if (before.Directory || before.EndOfFile.QuadPart < 0 ||
        (ULONGLONG)before.EndOfFile.QuadPart != Request->FileSize || Request->Offset > Request->FileSize)
        return STATUS_FILE_INVALID;
    if ((ULONGLONG)Capacity > Request->FileSize - Request->Offset)
        Capacity = (ULONG)(Request->FileSize - Request->Offset);
    if (Capacity != 0) {
        offset.QuadPart = (LONGLONG)Request->Offset;
        status = FltReadFile(Instance, FileObject, &offset, Capacity, Content,
            FLTFL_IO_OPERATION_DO_NOT_UPDATE_BYTE_OFFSET, &read, NULL, NULL);
        if (status != STATUS_SUCCESS || read != Capacity) { RtlZeroMemory(Content, Capacity); return STATUS_FILE_INVALID; }
    }
    status = FltQueryInformationFile(Instance, FileObject, &after, sizeof(after), FileStandardInformation, NULL);
    if (!NT_SUCCESS(status) || after.EndOfFile.QuadPart != before.EndOfFile.QuadPart) {
        RtlZeroMemory(Content, Capacity); return STATUS_FILE_INVALID;
    }
    if (ReadGeneration(Instance) != epoch) {
        RtlZeroMemory(Content, Capacity); return STATUS_RETRY;
    }
    Request->ContentLength = read;
    Request->Size = sizeof(*Request) + read;
    return STATUS_SUCCESS;
}
typedef struct _KALKAN_STREAM_STATE {
    volatile LONG64 Generation;
    volatile LONG WritableMappingSeen;
    BOOLEAN IdentityValid;
    ULONG StorageClass;
    ULONGLONG VolumeSerialNumber;
    FILE_ID_128 FileId;
    KSPIN_LOCK CacheLock;
    KALKAN_READ_CACHE Cache;
} KALKAN_STREAM_STATE;

NTSTATUS KalkanInspectOpenedFile(PFLT_INSTANCE Instance, PFILE_OBJECT FileObject,
    ULONGLONG PolicyRevision, PULONG Decision);
NTSTATUS KalkanInspectOpenedFile(PFLT_INSTANCE Instance, PFILE_OBJECT FileObject,
    ULONGLONG PolicyRevision, PULONG Decision)
{
    KALKAN_SCAN_REQUEST *request = NULL;
    KALKAN_SCAN_REQUEST initial;
    KALKAN_COVERAGE coverage = {0};
    KALKAN_POLICY_STATE policy;
    ULONGLONG refreshed;
    KIRQL oldIrql;
    NTSTATUS status;
    ULONGLONG started;
    LONG64 id;
    if (Decision == NULL) return STATUS_INVALID_PARAMETER;
    *Decision = KALKAN_DECISION_BLOCK;
    if (KeGetCurrentIrql() != PASSIVE_LEVEL) return STATUS_INVALID_DEVICE_STATE;
    KeAcquireSpinLock(&PolicyLock, &oldIrql);
    policy = PolicyState;
    refreshed = PolicyRefreshedAt;
    KeReleaseSpinLock(&PolicyLock, oldIrql);
    if (!KalkanPolicyMatches(&policy, PolicyRevision, policy.Epoch) ||
        !KalkanPolicyFresh(refreshed, KeQueryInterruptTime())) return STATUS_ACCESS_DENIED;
    if (!ExAcquireRundownProtection(&ScanRundown)) return STATUS_DELETE_PENDING;
    /* Admission covers preparation, allocation, reads and every chunk send;
       limiting only FltSendMessage leaves request-buffer allocation unbounded. */
    if (InterlockedIncrement(&InflightInspections) > KALKAN_MAX_INFLIGHT_SCANS) {
        InterlockedDecrement(&InflightInspections);
        ExReleaseRundownProtection(&ScanRundown);
        return STATUS_DEVICE_BUSY;
    }
    started = KeQueryInterruptTime();
    status = KalkanPrepareScanRequest(Instance, FileObject, PolicyRevision, &initial);
    if (status != STATUS_SUCCESS) goto InspectComplete;
    /* Bound work and memory while full-document parser integration is pending. */
    if (initial.FileSize > KALKAN_MAX_SCAN_FILE) { status = STATUS_FILE_TOO_LARGE; goto InspectComplete; }
    request = ExAllocatePool2(POOL_FLAG_NON_PAGED, sizeof(*request) + KALKAN_MAX_SCAN_CHUNK, 'qKlK');
    if (request == NULL) { status = STATUS_INSUFFICIENT_RESOURCES; goto InspectComplete; }
    *request = initial;
    do {
        KALKAN_SCAN_RESULT reply;
        if (KalkanScanDeadlineExpired(started, KeQueryInterruptTime())) { status = STATUS_TIMEOUT; break; }
        status = KalkanReadChunk(Instance, FileObject, request, request + 1, KALKAN_MAX_SCAN_CHUNK);
        if (status != STATUS_SUCCESS) break;
        status = KalkanSendScanRequest(Instance, request, request->Size, started, &reply);
        if (status != STATUS_SUCCESS) break;
        if (!KalkanCoverReply(&coverage, request, request->Size, &reply, sizeof(reply),
            status, KalkanScanDeadlineExpired(started, KeQueryInterruptTime()))) {
            status = STATUS_DATA_ERROR; break;
        }
        if (reply.Decision == KALKAN_DECISION_BLOCK) break;
        request->Offset += request->ContentLength;
        if (request->Offset == request->FileSize) {
            /* Revalidate admission at the authorization boundary as well as
               around each individual read/send. Do not nest instance and
               policy spin locks or query contexts while holding a spin lock. */
            if (ReadGeneration(Instance) != request->ContentGeneration) {
                status = STATUS_RETRY; break;
            }
            KeAcquireSpinLock(&PolicyLock, &oldIrql);
            if (KalkanCoverageAllows(&coverage) && KalkanPolicyMatches(&PolicyState, PolicyRevision, policy.Epoch) &&
                KalkanPolicyFresh(PolicyRefreshedAt, KeQueryInterruptTime()))
                *Decision = KALKAN_DECISION_ALLOW;
            else status = STATUS_ACCESS_DENIED;
            KeReleaseSpinLock(&PolicyLock, oldIrql);
            break;
        }
        id = InterlockedIncrement64(&NextScanId);
        if (id <= 0) { status = STATUS_INTEGER_OVERFLOW; break; }
        request->RequestId = (ULONGLONG)id;
    } while (TRUE);
    RtlSecureZeroMemory(request, sizeof(*request) + KALKAN_MAX_SCAN_CHUNK);
    ExFreePoolWithTag(request, 'qKlK');
InspectComplete:
    InterlockedDecrement(&InflightInspections);
    ExReleaseRundownProtection(&ScanRundown);
    return status;
}

static VOID EndVolumeRead(KALKAN_INSTANCE_STATE *state)
{
    KIRQL oldIrql;
    KeAcquireSpinLock(&state->IoLock, &oldIrql);
    KalkanEndRead(&state->Gate);
    KeReleaseSpinLock(&state->IoLock, oldIrql);
    FltReleaseContext(state);
}
static FLT_PREOP_CALLBACK_STATUS PreRead(PFLT_CALLBACK_DATA Data, PCFLT_RELATED_OBJECTS Objects, PVOID *Completion)
{
    KALKAN_INSTANCE_STATE *state = NULL;
    KALKAN_STREAM_STATE *stream = NULL;
    KALKAN_POLICY_STATE policy;
    KIRQL oldIrql;
    int accepted, cached = 0, authorized;
    ULONGLONG generation;
    ULONG decision = KALKAN_DECISION_BLOCK;
    NTSTATUS status;
    *Completion = NULL;
    if (Data->Iopb->Parameters.Read.Length == 0 ||
        !NT_SUCCESS(FltGetInstanceContext(Objects->Instance, (PFLT_CONTEXT *)&state))) return FLT_PREOP_SUCCESS_NO_CALLBACK;
    if (!ScopedInstance(state)) { FltReleaseContext(state); return FLT_PREOP_SUCCESS_NO_CALLBACK; }
    KeAcquireSpinLock(&PolicyLock, &oldIrql);
    policy = PolicyState;
    KeReleaseSpinLock(&PolicyLock, oldIrql);
    if (policy.Mode != KALKAN_POLICY_READY) { FltReleaseContext(state); goto DenyRead; }
    if (FLT_IS_FASTIO_OPERATION(Data)) { FltReleaseContext(state); return FLT_PREOP_DISALLOW_FASTIO; }
    if (!KalkanCanScanContext(KeGetCurrentIrql(), KeAreAllApcsDisabled(),
        IoGetTopLevelIrp() != NULL, (Data->Iopb->IrpFlags & IRP_PAGING_IO) != 0)) {
        FltReleaseContext(state); goto DenyRead;
    }
    KeAcquireSpinLock(&state->IoLock, &oldIrql);
    accepted = KalkanBeginRead(&state->Gate);
    generation = KalkanReadGeneration(&state->Gate);
    KeReleaseSpinLock(&state->IoLock, oldIrql);
    if (!accepted) { FltReleaseContext(state); goto DenyRead; }
    /* The stream context belongs to this filesystem stream, not a pathname.
       Missing contexts fall back to inspection, never to cached permission. */
    if (NT_SUCCESS(FltGetStreamContext(Objects->Instance, Objects->FileObject, (PFLT_CONTEXT *)&stream)) && stream != NULL) {
        KeAcquireSpinLock(&stream->CacheLock, &oldIrql);
        cached = KalkanReadCacheMatches(&stream->Cache, generation, policy.Revision,
            policy.Epoch, KeQueryInterruptTime());
        KeReleaseSpinLock(&stream->CacheLock, oldIrql);
    } else stream = NULL;
    if (cached) { status = STATUS_SUCCESS; decision = KALKAN_DECISION_ALLOW; }
    else status = KalkanInspectOpenedFile(Objects->Instance, Objects->FileObject, policy.Revision, &decision);
    /* Both cached and new results recheck current authorization. A policy
       reconnect with the same revision still changes PolicyEpoch. */
    KeAcquireSpinLock(&PolicyLock, &oldIrql);
    authorized = KalkanPolicyMatches(&PolicyState, policy.Revision, policy.Epoch) &&
        KalkanPolicyFresh(PolicyRefreshedAt, KeQueryInterruptTime());
    KeReleaseSpinLock(&PolicyLock, oldIrql);
    if (!authorized) { status = STATUS_ACCESS_DENIED; decision = KALKAN_DECISION_BLOCK; }
    if (stream) {
        if (!cached) {
            KeAcquireSpinLock(&stream->CacheLock, &oldIrql);
            KalkanReadCacheRecord(&stream->Cache, generation, policy.Revision, policy.Epoch,
                KeQueryInterruptTime(), status, decision);
            KeReleaseSpinLock(&stream->CacheLock, oldIrql);
        }
        FltReleaseContext(stream);
    }
    if (status != STATUS_SUCCESS || decision != KALKAN_DECISION_ALLOW) { EndVolumeRead(state); goto DenyRead; }
    /* Keep the admission reference through actual filesystem completion,
       rather than releasing it after the inspection and reopening a race. */
    *Completion = state;
    return FLT_PREOP_SUCCESS_WITH_CALLBACK;
DenyRead:
    Data->IoStatus.Status = STATUS_ACCESS_DENIED;
    Data->IoStatus.Information = 0;
    return FLT_PREOP_COMPLETE;
}
static FLT_POSTOP_CALLBACK_STATUS PostRead(PFLT_CALLBACK_DATA Data, PCFLT_RELATED_OBJECTS Objects, PVOID Completion, FLT_POST_OPERATION_FLAGS Flags)
{
    UNREFERENCED_PARAMETER(Data); UNREFERENCED_PARAMETER(Objects); UNREFERENCED_PARAMETER(Flags);
    if (Completion) EndVolumeRead(Completion);
    return FLT_POSTOP_FINISHED_PROCESSING;
}
static FLT_PREOP_CALLBACK_STATUS PreCreate(PFLT_CALLBACK_DATA Data, PCFLT_RELATED_OBJECTS Objects, PVOID *Completion)
{
    NTSTATUS status = STATUS_SUCCESS;
    *Completion = NULL;
    if (Data->Iopb->Parameters.Create.SecurityContext == NULL ||
        KalkanCreateMayMutate(Data->Iopb->Parameters.Create.Options,
            Data->Iopb->Parameters.Create.SecurityContext->DesiredAccess,
            Data->Iopb->Parameters.Create.EaLength,
            (ULONGLONG)Data->Iopb->Parameters.Create.AllocationSize.QuadPart))
        status = BeginVolumeMutation(Objects, FALSE, Completion);
    if (!NT_SUCCESS(status)) { Data->IoStatus.Status = status; Data->IoStatus.Information = 0; return FLT_PREOP_COMPLETE; }
    InterlockedIncrement(&ActiveMutations);
    InterlockedIncrement64(&MutationEpoch);
    return FLT_PREOP_SUCCESS_WITH_CALLBACK;
}
static FLT_POSTOP_CALLBACK_STATUS PostCreate(PFLT_CALLBACK_DATA Data, PCFLT_RELATED_OBJECTS Objects, PVOID Completion, FLT_POST_OPERATION_FLAGS Flags)
{
    KALKAN_STREAM_STATE *state = NULL;
    NTSTATUS status;
    EndVolumeMutation(Completion);
    InterlockedIncrement64(&MutationEpoch);
    InterlockedDecrement(&ActiveMutations);
    if ((Flags & FLTFL_POST_OPERATION_DRAINING) || !NT_SUCCESS(Data->IoStatus.Status) ||
        Data->IoStatus.Status == STATUS_REPARSE || KeGetCurrentIrql() > APC_LEVEL ||
        !FltSupportsStreamContexts(Objects->FileObject)) return FLT_POSTOP_FINISHED_PROCESSING;
    status = FltAllocateContext(Filter, FLT_STREAM_CONTEXT, sizeof(*state), NonPagedPoolNx, (PFLT_CONTEXT *)&state);
    if (NT_SUCCESS(status)) {
        KeInitializeSpinLock(&state->CacheLock);
        RtlZeroMemory(&state->Cache, sizeof(state->Cache));
        state->Generation = 1;
        state->WritableMappingSeen = 0;
        state->IdentityValid = FALSE;
        state->StorageClass = KALKAN_STORAGE_UNKNOWN;
        {
            KALKAN_INSTANCE_STATE *instance = NULL;
            if (NT_SUCCESS(FltGetInstanceContext(Objects->Instance, (PFLT_CONTEXT *)&instance))) {
                state->StorageClass = instance->StorageClass;
                FltReleaseContext(instance);
            }
        }
        state->VolumeSerialNumber = 0;
        RtlZeroMemory(&state->FileId, sizeof(state->FileId));
        /* Query the opened object, not a path reopened in user mode. Unsupported
           filesystems, unsafe query contexts and query errors remain unknown. */
        if (KeGetCurrentIrql() == PASSIVE_LEVEL && !KeAreAllApcsDisabled() && IoGetTopLevelIrp() == NULL) {
            FILE_ID_INFORMATION identity = {0};
            ULONG returned = 0;
            status = FltQueryInformationFile(Objects->Instance, Objects->FileObject,
                &identity, sizeof(identity), FileIdInformation, &returned);
            if (NT_SUCCESS(status) && returned == sizeof(identity)) {
                state->VolumeSerialNumber = identity.VolumeSerialNumber;
                state->FileId = identity.FileId;
                state->IdentityValid = TRUE;
            }
        }
        /* Existing stream state must survive additional opens. No context means unknown, never clean. */
        (VOID)FltSetStreamContext(Objects->Instance, Objects->FileObject,
            FLT_SET_CONTEXT_KEEP_IF_EXISTS, state, NULL);
        FltReleaseContext(state);
    }
    if (Data->IoStatus.Information != FILE_OPENED && NT_SUCCESS(FltGetStreamContext(
        Objects->Instance, Objects->FileObject, (PFLT_CONTEXT *)&state))) {
        InterlockedIncrement64(&state->Generation);
        FltReleaseContext(state);
    }
    return FLT_POSTOP_FINISHED_PROCESSING;
}
static FLT_PREOP_CALLBACK_STATUS PreMutation(PFLT_CALLBACK_DATA Data, PCFLT_RELATED_OBJECTS Objects, PVOID *Completion)
{
    KALKAN_STREAM_STATE *state = NULL;
    BOOLEAN mapped = FALSE;
    NTSTATUS status;
    *Completion = NULL;
    if (Data->Iopb->MajorFunction == IRP_MJ_ACQUIRE_FOR_SECTION_SYNCHRONIZATION) {
        if (Data->Iopb->Parameters.AcquireForSectionSynchronization.SyncType != SyncTypeCreateSection ||
            !(Data->Iopb->Parameters.AcquireForSectionSynchronization.PageProtection &
            (PAGE_READWRITE | PAGE_EXECUTE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_WRITECOPY))) return FLT_PREOP_SUCCESS_NO_CALLBACK;
        mapped = TRUE;
        /* Section lifetime is not tracked yet. Permanently prohibit caching
           for this driver lifetime after any writable section is observed. */
    }
    status = BeginVolumeMutation(Objects, mapped, Completion);
    if (!NT_SUCCESS(status)) {
        Data->IoStatus.Status = mapped ? STATUS_INSUFFICIENT_RESOURCES : status;
        Data->IoStatus.Information = 0; return FLT_PREOP_COMPLETE;
    }
    if (mapped) InterlockedExchange(&WritableSectionsSeen, 1);
    InterlockedIncrement(&ActiveMutations);
    InterlockedIncrement64(&MutationEpoch);
    /* Elevated/unsupported paths cannot establish a cacheable clean state. */
    if (KeGetCurrentIrql() <= APC_LEVEL && NT_SUCCESS(FltGetStreamContext(
        Objects->Instance, Objects->FileObject, (PFLT_CONTEXT *)&state))) {
        InterlockedIncrement64(&state->Generation);
        if (mapped) InterlockedExchange(&state->WritableMappingSeen, 1);
        FltReleaseContext(state);
    }
    return FLT_PREOP_SUCCESS_WITH_CALLBACK;
}
static FLT_POSTOP_CALLBACK_STATUS PostMutation(PFLT_CALLBACK_DATA Data, PCFLT_RELATED_OBJECTS Objects, PVOID Completion, FLT_POST_OPERATION_FLAGS Flags)
{
    UNREFERENCED_PARAMETER(Data); UNREFERENCED_PARAMETER(Objects);
    UNREFERENCED_PARAMETER(Flags);
    InterlockedIncrement64(&MutationEpoch);
    InterlockedDecrement(&ActiveMutations);
    EndVolumeMutation(Completion);
    return FLT_POSTOP_FINISHED_PROCESSING;
}

static NTSTATUS CreatePortSecurity(PSECURITY_DESCRIPTOR Descriptor, PACL Acl, ULONG AclSize)
{
    /* Stable service SID, verified using sc.exe showsid KalkanDlpAgent.
       Avoid importing RtlCreateServiceSid, which is not in the target kernel import library. */
    struct { UCHAR Revision; UCHAR Count; SID_IDENTIFIER_AUTHORITY Authority; ULONG Sub[6]; } sid = {
        SID_REVISION, 6, SECURITY_NT_AUTHORITY,
        { 80, 1996245872u, 495940426u, 2606424254u, 3197979588u, 1870923827u }
    };
    NTSTATUS status = RtlCreateAcl(Acl, AclSize, ACL_REVISION);
    if (!NT_SUCCESS(status)) return status;
    status = RtlAddAccessAllowedAce(Acl, ACL_REVISION, FLT_PORT_ALL_ACCESS, &sid);
    if (!NT_SUCCESS(status)) return status;
    status = RtlAddAccessAllowedAce(Acl, ACL_REVISION, FLT_PORT_ALL_ACCESS, SeExports->SeLocalSystemSid);
    if (!NT_SUCCESS(status)) return status;
    status = RtlCreateSecurityDescriptor(Descriptor, SECURITY_DESCRIPTOR_REVISION);
    if (!NT_SUCCESS(status)) return status;
    return RtlSetDaclSecurityDescriptor(Descriptor, TRUE, Acl, FALSE);
}

DRIVER_INITIALIZE DriverEntry;
static NTSTATUS Connect(PFLT_PORT Port, PVOID ServerCookie, PVOID Context, ULONG ContextSize, PVOID *Cookie)
{
    KALKAN_HELLO_MESSAGE hello;
    UNREFERENCED_PARAMETER(ServerCookie);
    *Cookie = NULL;
    if (Context == NULL || ContextSize != sizeof(hello)) return STATUS_INVALID_PARAMETER;
    __try {
        RtlCopyMemory(&hello, Context, sizeof(hello));
    } __except(EXCEPTION_EXECUTE_HANDLER) {
        return GetExceptionCode();
    }
    if (!KalkanValidHello(&hello, ContextSize)) return STATUS_REVISION_MISMATCH;
    ClientPort = Port;
    return STATUS_SUCCESS;
}
static VOID Disconnect(PVOID Cookie)
{
    KIRQL oldIrql;
    KALKAN_POLICY_UPDATE unavailable = { KALKAN_PROTOCOL_VERSION, sizeof(unavailable), KALKAN_POLICY_UPDATE_COMMAND, KALKAN_POLICY_UNAVAILABLE, 0, 0 };
    UNREFERENCED_PARAMETER(Cookie);
    KeAcquireSpinLock(&PolicyLock, &oldIrql);
    (VOID)KalkanApplyPolicy(&PolicyState, &unavailable, sizeof(unavailable));
    KeReleaseSpinLock(&PolicyLock, oldIrql);
    FltCloseClientPort(Filter, &ClientPort);
}
static NTSTATUS Message(PVOID Cookie, PVOID Input, ULONG InputSize, PVOID Output, ULONG OutputSize, PULONG Returned)
{
    KALKAN_HELLO_MESSAGE hello;
    UNREFERENCED_PARAMETER(Cookie);
    *Returned = 0;
    if (Input != NULL && InputSize == sizeof(KALKAN_POLICY_UPDATE)) {
        KALKAN_POLICY_UPDATE update;
        KIRQL oldIrql;
        int accepted;
        __try { RtlCopyMemory(&update, Input, sizeof(update)); }
        __except(EXCEPTION_EXECUTE_HANDLER) { return GetExceptionCode(); }
        KeAcquireSpinLock(&PolicyLock, &oldIrql);
        accepted = KalkanApplyPolicy(&PolicyState, &update, sizeof(update));
        if (accepted) PolicyRefreshedAt = KeQueryInterruptTime();
        KeReleaseSpinLock(&PolicyLock, oldIrql);
        return accepted ? STATUS_SUCCESS : STATUS_INVALID_PARAMETER;
    }
    if (Input == NULL || InputSize != sizeof(hello) || Output == NULL) return STATUS_INVALID_PARAMETER;
    __try {
        RtlCopyMemory(&hello, Input, sizeof(hello));
        if (hello.Version == KALKAN_PROTOCOL_VERSION && hello.Size == sizeof(hello) &&
            hello.Command == KALKAN_QUERY_STATUS && hello.Reserved == 0) {
            KALKAN_STATUS_RESULT result = {0};
            if (OutputSize < sizeof(result)) return STATUS_BUFFER_TOO_SMALL;
            result.Version = KALKAN_PROTOCOL_VERSION;
            result.Size = sizeof(result);
            result.Command = KALKAN_QUERY_STATUS;
            result.ProtectionActive = 0;
            /* Diagnostic values only: not one atomic authorization snapshot. */
            result.MutationEpoch = (ULONGLONG)InterlockedCompareExchange64(&MutationEpoch, 0, 0);
            result.ActiveMutations = InterlockedCompareExchange(&ActiveMutations, 0, 0);
            result.WritableSectionsSeen = (ULONG)InterlockedCompareExchange(&WritableSectionsSeen, 0, 0);
            RtlCopyMemory(Output, &result, sizeof(result));
            *Returned = sizeof(result);
            return STATUS_SUCCESS;
        }
        if (!KalkanValidHello(&hello, InputSize)) return STATUS_INVALID_PARAMETER;
        if (OutputSize < sizeof(hello)) return STATUS_BUFFER_TOO_SMALL;
        RtlCopyMemory(Output, &hello, sizeof(hello));
        *Returned = sizeof(hello);
    } __except(EXCEPTION_EXECUTE_HANDLER) { return GetExceptionCode(); }
    return STATUS_SUCCESS;
}
static NTSTATUS Unload(FLT_FILTER_UNLOAD_FLAGS Flags)
{
    UNREFERENCED_PARAMETER(Flags);
    FltCloseCommunicationPort(ServerPort);
    /* Stop admission and wait for bounded sends before unregistering Filter. */
    ExWaitForRundownProtectionRelease(&ScanRundown);
    FltUnregisterFilter(Filter);
    return STATUS_SUCCESS;
}
static const FLT_CONTEXT_REGISTRATION Contexts[] = {
    { FLT_INSTANCE_CONTEXT, 0, NULL, sizeof(KALKAN_INSTANCE_STATE), 'iKlK' },
    { FLT_STREAM_CONTEXT, 0, NULL, sizeof(KALKAN_STREAM_STATE), 'sKlK' },
    { FLT_CONTEXT_END }
};
static const FLT_OPERATION_REGISTRATION Operations[] = {
    { IRP_MJ_READ, 0, PreRead, PostRead },
    { IRP_MJ_CREATE, 0, PreCreate, PostCreate },
    { IRP_MJ_WRITE, 0, PreMutation, PostMutation },
    { IRP_MJ_SET_INFORMATION, 0, PreMutation, PostMutation },
    { IRP_MJ_FILE_SYSTEM_CONTROL, 0, PreMutation, PostMutation },
    { IRP_MJ_ACQUIRE_FOR_SECTION_SYNCHRONIZATION, 0, PreMutation, PostMutation },
    { IRP_MJ_OPERATION_END }
};
static const FLT_REGISTRATION Registration = {
    sizeof(FLT_REGISTRATION), FLT_REGISTRATION_VERSION, 0, Contexts, Operations,
    Unload, InstanceSetup, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
};
NTSTATUS DriverEntry(PDRIVER_OBJECT DriverObject, PUNICODE_STRING RegistryPath)
{
    NTSTATUS status;
    SECURITY_DESCRIPTOR security;
    union { ULONG Alignment; UCHAR Bytes[sizeof(ACL) + 2 * (sizeof(ACCESS_ALLOWED_ACE) - sizeof(ULONG) + SECURITY_MAX_SID_SIZE)]; } acl;
    OBJECT_ATTRIBUTES attributes;
    UNICODE_STRING name = RTL_CONSTANT_STRING(KALKAN_PORT_NAME);
    UNREFERENCED_PARAMETER(RegistryPath);
    ExInitializeRundownProtection(&ScanRundown);
    KeInitializeSpinLock(&PolicyLock);
    PolicyState.Mode = KALKAN_POLICY_UNAVAILABLE;
    status = FltRegisterFilter(DriverObject, &Registration, &Filter);
    if (!NT_SUCCESS(status)) return status;
    /* Only the dedicated agent service SID and SYSTEM may connect. */
    status = CreatePortSecurity(&security, (PACL)acl.Bytes, sizeof(acl.Bytes));
    if (NT_SUCCESS(status)) {
        InitializeObjectAttributes(&attributes, &name, OBJ_KERNEL_HANDLE | OBJ_CASE_INSENSITIVE, NULL, &security);
        status = FltCreateCommunicationPort(Filter, &ServerPort, &attributes, NULL, Connect, Disconnect, Message, 1);
    }
    if (!NT_SUCCESS(status)) { FltUnregisterFilter(Filter); return status; }
    status = FltStartFiltering(Filter);
    if (!NT_SUCCESS(status)) { FltCloseCommunicationPort(ServerPort); FltUnregisterFilter(Filter); }
    return status;
}
