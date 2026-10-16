"""Message bus module for decoupled channel-agent communication."""

from nanobuddy.bus.events import InboundMessage, OutboundMessage
from nanobuddy.bus.queue import MessageBus

__all__ = ["MessageBus", "InboundMessage", "OutboundMessage"]
