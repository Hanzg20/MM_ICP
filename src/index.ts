import { Canister, query, text, update, Void } from 'azle';
import { $query, $update, Record, StableBTreeMap, Vec, match, Result, nat64, ic, Opt, Principal } from 'azle';
import { v4 as uuidv4 } from 'uuid';
// This is a global variable that is stored on the heap
let message = '';

type Membership = Record<{
    creator: Principal;
    id: string;
    merchantName: string;
    registrationDate: nat64;
    expirationDate: nat64;
    members: Vec<Principal>; // List of members associated with the merchant
    benefits: Vec<string>; // Membership benefits
    status: string; // Status of the membership (Active, Expired, etc.)
}>;

type MembershipPayload = Record<{
    merchantName: string;
    expirationDate: string;
    benefits: Vec<string>;
}>;

const membershipStorage = new StableBTreeMap<string, Membership>(0, 44, 512);

// Number of Memberships to load initially
const initialLoadSize = 4;

// Load the Initial batch of Memberships
$query
export function getInitialMemberships(): Result<Vec<Membership>, string> {
    const initialMemberships = membershipStorage.values().slice(0, initialLoadSize);
    return Result.Ok(initialMemberships);
}

// Load more Memberships as needed
$query
export function loadMoreMemberships(offset: number, limit: number): Result<Vec<Membership>, string> {
    const moreMemberships = membershipStorage.values().slice(offset, offset + limit);
    return Result.Ok(moreMemberships);
}

// Get Membership by ID
$query
export function getMembership(id: string): Result<Membership, string> {
    return match(membershipStorage.get(id), {
        Some: (membership) => {
            if (membership.creator.toString() !== ic.caller().toString()) {
                return Result.Err<Membership, string>('You are not authorized to access this Membership');
            }
            return Result.Ok<Membership, string>(membership);
        },
        None: () => Result.Err<Membership, string>(`Membership with id:${id} not found`),
    });
}

// Get Memberships by Status (Active, Expired, etc.)
$query
export function getMembershipsByStatus(status: string): Result<Vec<Membership>, string> {
    const membershipsByStatus = membershipStorage.values().filter((membership) => membership.status === status);
    return Result.Ok(membershipsByStatus);
}

// Create a new Membership
$update
export function createMembership(payload: MembershipPayload): Result<Membership, string> {
    // Validate input data
    if (!payload.merchantName || !payload.expirationDate) {
        return Result.Err<Membership, string>('Missing or invalid input data');
    }

    try {
        const newMembership: Membership = {
            creator: ic.caller(),
            id: uuidv4(),
            registrationDate: ic.time(),
            members: Vec.fromArray([ic.caller()]), // The creator is automatically added as a member
            status: 'Active', // Assuming new memberships are active by default
            ...payload,
        };
        membershipStorage.insert(newMembership.id, newMembership);
        return Result.Ok<Membership, string>(newMembership);
    } catch (err) {
        return Result.Err<Membership, string>('Issue encountered when creating Membership');
    }
}

// Add a member to an existing Membership
@update
export function addMember(id: string, member: Principal): Result<Membership, string> {
    return match(membershipStorage.get(id), {
        Some: (membership) => {
            if (membership.creator.toString() !== ic.caller().toString()) {
                return Result.Err<Membership, string>('You are not authorized to add a member');
            }
            const updatedMembers = [...membership.members.toArray(), member];
            const updatedMembership: Membership = { ...membership, members: Vec.fromArray(updatedMembers) };
            membershipStorage.insert(membership.id, updatedMembership);
            return Result.Ok<Membership, string>(updatedMembership);
        },
        None: () => Result.Err<Membership, string>(`Membership with id:${id} not found`),
    });
}

// Extend Membership Expiration Date
@update
export function extendMembership(id: string, newExpirationDate: string): Result<Membership, string> {
    return match(membershipStorage.get(id), {
        Some: (membership) => {
            if (membership.creator.toString() !== ic.caller().toString()) {
                return Result.Err<Membership, string>('You are not authorized to extend the membership');
            }
            const updatedMembership: Membership = { ...membership, expirationDate: newExpirationDate };
            membershipStorage.insert(membership.id, updatedMembership);
            return Result.Ok<Membership, string>(updatedMembership);
        },
        None: () => Result.Err<Membership, string>(`Membership with id:${id} not found`),
    });
}

// Deactivate Membership
@update
export function deactivateMembership(id: string): Result<Membership, string> {
    return match(membershipStorage.get(id), {
        Some: (membership) => {
            if (membership.creator.toString() !== ic.caller().toString()) {
                return Result.Err<Membership, string>('You are not authorized to deactivate the membership');
            }
            const updatedMembership: Membership = { ...membership, status: 'Inactive' };
            membershipStorage.insert(membership.id, updatedMembership);
            return Result.Ok<Membership, string>(updatedMembership);
        },
        None: () => Result.Err<Membership, string>(`Membership with id:${id} not found`),
    });
}

// Update Membership Benefits
@update
export function updateMembershipBenefits(id: string, benefits: Vec<string>): Result<Membership, string> {
    return match(membershipStorage.get(id), {
        Some: (membership) => {
            if (membership.creator.toString() !== ic.caller().toString()) {
                return Result.Err<Membership, string>('You are not authorized to update benefits');
            }
            const updatedMembership: Membership = { ...membership, benefits };
            membershipStorage.insert(membership.id, updatedMembership);
            return Result.Ok<Membership, string>(updatedMembership);
        },
        None: () => Result.Err<Membership, string>(`Membership with id:${id} not found`),
    });
}

// Get Memberships by Creator
$query
export function getMembershipsByCreator(creator: Principal): Result<Vec<Membership>, string> {
    const creatorMemberships = membershipStorage.values().filter((membership) => membership.creator.toString() === creator.toString());
    return Result.Ok(creatorMemberships);
}

// Membership Expiry Reminder
$query
export function membershipExpiryReminder(id: string): Result<string, string> {
    const now = new Date().toISOString();
    return match(membershipStorage.get(id), {
        Some: (membership) => {
            if (membership.expirationDate < now && membership.status !== 'Inactive') {
                return Result.Ok<string, string>('Membership is expired. Please renew it.');
            } else {
                return Result.Err<string, string>('Membership is not expired or already inactive.');
            }
        },
        None: () => Result.Err<string, string>(`Membership with id:${id} not found`),
    });
}

export default Canister({
    // Query calls complete quickly because they do not go through consensus
    getMessage: query([], text, () => {
        return message;
    }),
    // Update calls take a few seconds to complete
    // This is because they persist state changes and go through consensus
    setMessage: update([text], Void, (newMessage) => {
        message = newMessage; // This change will be persisted
    })
});

// UUID workaround
