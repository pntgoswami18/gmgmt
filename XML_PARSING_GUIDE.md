# SecureEye S560 XML Message Parsing

This document explains the XML message format support added for SecureEye S560 biometric devices.

## Message Format

The S560 device sends XML messages in this format:

```xml
<?xml version="1.0"?>
<Message>
    <TerminalType>S560</TerminalType>
    <DeviceUID>31316063-532063e4</DeviceUID>
    <TerminalID>1</TerminalID>
    <DeviceSerialNo>102024010000211</DeviceSerialNo>
    <TransID>19334</TransID>
    <Event>TimeLog</Event>
    <Year>2025</Year>
    <Month>6</Month>
    <Day>5</Day>
    <Hour>20</Hour>
    <Minute>26</Minute>
    <Second>30</Second>
    <UserID>4</UserID>
    <AttendStat>Overtime On</AttendStat>
    <VerifMode>FP</VerifMode>
    <JobCode>0</JobCode>
    <APStat>None</APStat>
    <Photo>No</Photo>
</Message>
```

## Parsed Output

The system now automatically parses these messages into this standardized format:

```json
{
  "userId": "4",
  "timestamp": "2025-06-05T14:56:30.000Z",
  "status": "authorized",
  "deviceId": "31316063-532063e4",
  "event": "TimeLog",
  "verifMode": "FP",
  "attendStat": "Overtime On",
  "terminalType": "S560",
  "transactionId": "19334",
  "rawMessage": "<?xml version=\"1.0\"?>..."
}
```

## Field Mapping

| XML Field | Parsed Field | Description |
|-----------|--------------|-------------|
| `UserID` | `userId` | Biometric device user ID |
| `Year/Month/Day/Hour/Minute/Second` | `timestamp` | Combined into ISO timestamp (UTC) |
| `Event` | `event` | Event type (e.g., "TimeLog") |
| `VerifMode` | `verifMode` | Verification method (e.g., "FP" for fingerprint) |
| `AttendStat` | `attendStat` | Attendance status |
| `TerminalType` | `terminalType` | Device model |
| `DeviceUID` | `deviceId` | Device unique identifier |
| `TransID` | `transactionId` | Transaction ID |

## Status Determination

The parser automatically determines the status based on:

- **authorized**: When `Event=TimeLog` AND `VerifMode=FP` AND `UserID` exists
- **parse_error**: When XML parsing fails
- **unknown**: For unrecognized patterns

## Event Flow

1. **Device sends XML message** → TCP connection
2. **BiometricListener receives** → `parseAndHandleBiometricData()`
3. **XML detected** → `parseSecureEyeXML()` called
4. **Status = "authorized"** → `accessGranted` event emitted
5. **BiometricIntegration** → Records attendance in database

## Timezone Notes

- Device sends local time in individual components
- System converts to UTC timestamp for storage
- Time difference is normal and expected

## Testing

To test XML parsing manually:

```bash
# Use the built-in biometric test tools
npm run biometric:test

# Check if service is listening
npm run biometric:check
```

## Troubleshooting

If messages appear as "Unknown biometric message":

1. **Check XML format**: Ensure message starts with `<?xml` or contains `<Message>`
2. **Verify connectivity**: Device must connect to configured port
3. **Check logs**: Look for parsing errors in console output
4. **Validate UserID**: Must be present and numeric for status determination

## Supported Formats

The system now supports:

- ✅ **JSON** format (existing)
- ✅ **CSV** format (existing) 
- ✅ **XML** format (SecureEye S560) - **NEW**
- ✅ **Simple string** format (existing)
