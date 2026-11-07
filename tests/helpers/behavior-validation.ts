import { expect } from 'bun:test';

type UnknownRecord = Record<string, unknown>;
type NotificationType = 'platform:gift' | 'platform:follow' | 'platform:paypiggy' | 'platform:raid' | 'platform:envelope';

const isRecord = (value: unknown): value is UnknownRecord => {
    return typeof value === 'object' && value !== null;
};

const requireRecord = (value: unknown, name: string): UnknownRecord => {
    if (!isRecord(value)) {
        throw new Error(`${name} must be an object`);
    }

    return value;
};

const isNotificationType = (type: string): type is NotificationType => {
    return ['platform:gift', 'platform:follow', 'platform:paypiggy', 'platform:raid', 'platform:envelope'].includes(type);
};

const validateUserVisibleContent = (content: unknown): void => {
    if (typeof content !== 'string') {
        throw new Error('User-visible content must be a string');
    }

    const technicalArtifacts = ['undefined', 'null', 'NaN', '[object Object]'];
    technicalArtifacts.forEach(artifact => {
        if (content.includes(artifact)) {
            throw new Error(`User-visible content contains technical artifact "${artifact}"`);
        }
    });

    if (/\{.*\}/.test(content)) {
        throw new Error('User-visible content contains template placeholders');
    }

    if (/TypeError:|ReferenceError:|SyntaxError:/.test(content)) {
        throw new Error('User-visible content contains JavaScript error');
    }

    if (!content.trim()) {
        throw new Error('User-visible content is empty or whitespace-only');
    }
};

const validateGiftData = (giftData: unknown): void => {
    const giftRecord = requireRecord(giftData, 'Gift data');

    const requiredFields = ['username', 'amount', 'currency'];
    requiredFields.forEach(field => {
        if (!Object.prototype.hasOwnProperty.call(giftRecord, field)) {
            throw new Error(`Gift data missing required field: ${field}`);
        }
    });

    if (!giftRecord.username || typeof giftRecord.username !== 'string' || !giftRecord.username.trim()) {
        throw new Error('Gift data must include a valid username');
    }

    if (typeof giftRecord.amount !== 'number' || !Number.isFinite(giftRecord.amount) || giftRecord.amount <= 0) {
        throw new Error('Gift amount must be a positive number');
    }

    if (typeof giftRecord.currency !== 'string' || !giftRecord.currency.trim()) {
        throw new Error('Gift currency must be a non-empty string');
    }
};

const validateNotificationData = (notificationData: unknown): void => {
    const notificationRecord = requireRecord(notificationData, 'Notification data');

    const requiredFields = ['type', 'username'];
    requiredFields.forEach(field => {
        if (!Object.prototype.hasOwnProperty.call(notificationRecord, field)) {
            throw new Error(`Notification data missing required field: ${field}`);
        }
    });

    if (typeof notificationRecord.type !== 'string' || !isNotificationType(notificationRecord.type)) {
        throw new Error(`Invalid notification type: ${notificationRecord.type}`);
    }

    if (!notificationRecord.username || typeof notificationRecord.username !== 'string' || !notificationRecord.username.trim()) {
        throw new Error('Notification data must include a valid username');
    }
};

const expectValidNotification = <Notification>(notification: Notification): Notification => {
    expect(notification).toBeDefined();
    expect((notification as UnknownRecord).displayMessage).toBeDefined();
    return notification;
};

const expectNoTechnicalArtifacts = (str: unknown): string | undefined => {
    if (!str) return;
    if (typeof str !== 'string') {
        throw new Error('Content must be a string');
    }
    
    const technicalPatterns = [
        /undefined/i,
        /null/i,
        /\[object/i,
        /NaN/i,
        /^\s*$/,
        /{.*}/,
        /\$\$/,
        /\bfunction\b/i
    ];
    
    technicalPatterns.forEach(pattern => {
        expect(str).not.toMatch(pattern);
    });
    
    return str;
};

const expectValidUserFeedback = (feedback?: unknown): string => {
    if (!feedback) {
        throw new Error('User feedback is required');
    }
    
    if (typeof feedback !== 'string') {
        throw new Error('User feedback must be a string');
    }
    
    if (feedback.trim().length < 3) {
        throw new Error('User feedback too short to be meaningful');
    }
    
    expectNoTechnicalArtifacts(feedback);
    
    const hasUserRelevantContent = [
        /\b(user|viewer|streamer|chat|effect|VFX|visual|command)\b/i,
        /\b(successful|complete|executed|triggered|displayed)\b/i,
        /\b(welcome|hello|gift|thank|greet)\b/i
    ].some(pattern => pattern.test(feedback));
    
    if (!hasUserRelevantContent) {
        throw new Error('User feedback should contain user-relevant information');
    }
    
    return feedback;
};

export {
    validateUserVisibleContent,
    validateGiftData,
    validateNotificationData,
    expectValidNotification,
    expectNoTechnicalArtifacts,
    expectValidUserFeedback
};
