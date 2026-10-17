"""Normalize acceptance without mistaking an SMTP Message-ID for a Gmail id."""


def accepted_result(result):
    if not isinstance(result, dict):
        raise ValueError('Provider acceptance was not confirmed')
    if isinstance(result.get('id'), str) and result['id'].strip():
        return {'provider_message_id': result['id'], 'provider_thread_id': result.get('threadId')}
    if result.get('accepted') is True and result.get('provider') == 'gmail_smtp' and result.get('smtp_response_code') == 250:
        return {'message_id': result.get('message_id'), 'smtp_response_code': 250}
    raise ValueError('Provider acceptance was not confirmed')
