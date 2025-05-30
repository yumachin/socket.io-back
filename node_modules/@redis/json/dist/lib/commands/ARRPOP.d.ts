import { CommandParser } from '@redis/client/dist/lib/client/parser';
import { RedisArgument, ArrayReply, NullReply, BlobStringReply } from '@redis/client/dist/lib/RESP/types';
export interface RedisArrPopOptions {
    path: RedisArgument;
    index?: number;
}
declare const _default: {
    readonly IS_READ_ONLY: false;
    readonly parseCommand: (this: void, parser: CommandParser, key: RedisArgument, options?: RedisArrPopOptions) => void;
    readonly transformReply: (this: void, reply: NullReply | BlobStringReply | ArrayReply<NullReply | BlobStringReply>) => string | number | boolean | NullReply | Date | {
        [key: string]: import("./helpers").RedisJSON;
        [key: number]: import("./helpers").RedisJSON;
    } | (NullReply | import("./helpers").RedisJSON)[] | null;
};
export default _default;
//# sourceMappingURL=ARRPOP.d.ts.map