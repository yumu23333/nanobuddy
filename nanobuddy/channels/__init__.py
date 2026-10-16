"""Chat channels module with plugin architecture."""

from nanobuddy.channels.base import BaseChannel
from nanobuddy.channels.manager import ChannelManager

__all__ = ["BaseChannel", "ChannelManager"]
