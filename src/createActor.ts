import {MailboxTypes} from "./getMailbox";
export function createActor (input) {
    return {
        ...input,
        mailboxType: MailboxTypes.default
    };
}