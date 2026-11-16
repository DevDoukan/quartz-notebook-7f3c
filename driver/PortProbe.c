#include <windows.h>
#include <fltUser.h>
#include <stdio.h>
#include <string.h>
#include "KalkanProtocol.h"
int main(void)
{
    HANDLE port = INVALID_HANDLE_VALUE;
    KALKAN_HELLO_MESSAGE hello = { KALKAN_PROTOCOL_VERSION, sizeof(hello), KALKAN_HELLO, 0 };
    KALKAN_HELLO_MESSAGE reply = {0};
    DWORD returned = 0;
    HRESULT result = FilterConnectCommunicationPort(KALKAN_PORT_NAME, 0, &hello, sizeof(hello), NULL, &port);
    KALKAN_STATUS_RESULT status = {0};
    if (FAILED(result)) { printf("Port connection failed: 0x%08lx\n", (unsigned long)result); return 1; }
    result = FilterSendMessage(port, &hello, sizeof(hello), &reply, sizeof(reply), &returned);
    if (FAILED(result) || !KalkanValidHello(&reply, returned) || memcmp(&hello, &reply, sizeof(hello)) != 0) {
        CloseHandle(port); printf("HELLO verification failed: 0x%08lx\n", (unsigned long)result); return 1;
    }
    puts("Kalkan driver transport HELLO verified. File protection is not tested.");
    hello.Command = KALKAN_QUERY_STATUS;
    result = FilterSendMessage(port, &hello, sizeof(hello), &status, sizeof(status), &returned);
    CloseHandle(port);
    if (FAILED(result) || !KalkanValidStatus(&status, returned)) {
        printf("Status verification failed: 0x%08lx\n", (unsigned long)result); return 1;
    }
    printf("ProtectionActive=0 MutationEpoch=%llu ActiveMutations=%ld WritableSectionsSeen=%lu\n",
        status.MutationEpoch, status.ActiveMutations, status.WritableSectionsSeen);
    return 0;
}
